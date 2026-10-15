import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * 阿里云百炼语音合成 Qwen-Audio-TTS 封装（见技术方案 6.5）。
 * API Key 只存在于后端环境变量中，小程序端永不接触（见技术方案 6.2）。
 *
 * 与 ASR 的关键差异：ASR 每次都是新内容，TTS 则高度重复——
 * 「apple」这个词可能被点几十次。所以这里做了一层**落盘缓存**，
 * 同一段文本（同一音色/语速）只会真正调用百炼一次，之后直接读盘。
 * 缓存只增不减（改音色、场景重生成都会留下不再命中的旧文件），
 * 所以另设 TTS_CACHE_MAX_MB 上限兜底，超限按 mtime 删最旧的（见 trimCache）。
 *
 * 注意：该模型目前仅华北2（北京）地域可用，且与 ASR 共用一个 DASHSCOPE_API_KEY。
 * 若把 ASR 迁到新加坡地域的 Key，TTS 会直接不可用，两者不能混用一套配置。
 */

/** 音色是「可变常量」：改 .env 的 TTS_VOICE 重启即换，可选清单见 .env.example */
const DEFAULT_VOICE = 'Andy_v3.1';
const DEFAULT_MODEL = 'qwen-audio-3.1-tts-flash';
const DEFAULT_FORMAT = 'mp3';
/** 目标语言提示：让数字与符号按英文读（110 → one one zero，而不是幺幺零） */
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_CACHE_DIR = './tts-cache';
/** 缓存目录体积上限（MB）。非法值退回默认，与 TTS_RATE 的处理保持一致。 */
const DEFAULT_CACHE_MAX_MB = 200;

export interface SynthesizeResult {
  buffer: Buffer;
  format: string;
  cached: boolean;
}

/** 暴露给前端的部分：前端要用它拼本地缓存 key（见 tts.controller.ts） */
export interface TtsConfig {
  voice: string;
  rate: number;
  format: string;
}

interface CacheFile {
  path: string;
  size: number;
  mtime: number;
}

interface SynthParams {
  text: string;
  model: string;
  voice: string;
  rate: number;
  format: string;
  language: string;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  /**
   * 同一 key 的并发合成只打一次百炼。
   * 前端预取与用户点击几乎必然同时到达，没有这层会重复计费；
   * 前端自己也做了去重，但那是「同一个页面的同一次点击」，兜不到这种竞态。
   */
  private readonly inflight = new Map<string, Promise<Buffer>>();

  /**
   * 缓存目录当前占用字节。重启后第一次写盘时扫一遍目录初始化，之后靠增量维护——
   * 命中缓存根本不写盘，写入是低频事件，但还是不值得每次去 stat 整个目录。
   */
  private cacheBytes: number | null = null;

  /** 清理串行化：并发写盘时各扫各的会重复统计，还会抢着删同一批文件 */
  private sweeping: Promise<void> | null = null;

  get publicConfig(): TtsConfig {
    const { voice, rate, format } = this.config;
    return { voice, rate, format };
  }

  /** 文本 → 音频字节。命中缓存则完全不碰百炼。 */
  async synthesize(rawText: string): Promise<SynthesizeResult> {
    const text = this.normalize(rawText);
    const params = { ...this.config, text };
    const { format } = params;

    const key = this.cacheKey(params);
    const file = this.cachePath(key, format);

    const hit = await this.readCache(file);
    if (hit) return { buffer: hit, format, cached: true };

    const running = this.inflight.get(key);
    if (running) return { buffer: await running, format, cached: false };

    const task = this.generate(params, file);
    this.inflight.set(key, task);
    try {
      return { buffer: await task, format, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  private async generate(params: SynthParams, file: string): Promise<Buffer> {
    const buffer = await this.synthesizeRemote(params);
    await this.writeCache(file, buffer);
    return buffer;
  }

  /** 调百炼合成。非流式返回的是音频文件 URL 而非字节，所以这里还要再下载一次。 */
  private async synthesizeRemote(params: SynthParams): Promise<Buffer> {
    // 不单独配 TTS_BASE_URL 时跟随 ASR——两者同属一个地域与工作空间
    const baseUrl = process.env.TTS_BASE_URL || process.env.ASR_BASE_URL;
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new ServiceUnavailableException('朗读服务未配置');
    }

    try {
      const res = await axios.post(
        `${baseUrl}/api/v1/services/audio/tts/SpeechSynthesizer`,
        {
          model: params.model,
          input: {
            text: params.text,
            voice: params.voice,
            format: params.format,
            rate: params.rate,
            language_hints: [params.language],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60_000,
        },
      );

      const audio = res.data?.output?.audio;
      // 文档上非流式 data 为空、url 有值，流式反过来。两条路都兜住，
      // 免得哪天接口行为调整就直接哑掉。
      if (typeof audio?.data === 'string' && audio.data) {
        return Buffer.from(audio.data, 'base64');
      }
      if (audio?.url) {
        // OSS 签名直链，不需要再带 Authorization
        const file = await axios.get(audio.url, {
          responseType: 'arraybuffer',
          timeout: 60_000,
        });
        return Buffer.from(file.data);
      }
      throw new ServiceUnavailableException('朗读服务未返回音频');
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw this.mapError(e);
    }
  }

  /** 空白折叠 + 空值卡口。文本全部来自本站 LLM 输出，且未开启 SSML，无需额外转义。 */
  private normalize(raw: string): string {
    const text = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) throw new BadRequestException('朗读文本不能为空');
    return text;
  }

  /**
   * 缓存 key 必须包含 voice / rate：否则改了 TTS_VOICE 之后，
   * 同一个词命中的还是旧音色的缓存（服务端和前端都会踩这个坑）。
   */
  private cacheKey(params: SynthParams): string {
    return createHash('sha1')
      .update(
        [params.model, params.voice, params.rate, params.format, params.text].join('|'),
      )
      .digest('hex');
  }

  private get cacheDir(): string {
    return resolve(process.env.TTS_CACHE_DIR || DEFAULT_CACHE_DIR);
  }

  private get cacheMaxBytes(): number {
    const mb = Number(process.env.TTS_CACHE_MAX_MB);
    return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_CACHE_MAX_MB) * 1024 * 1024;
  }

  /** 按 key 前 2 位分子目录，避免单目录堆几千个文件 */
  private cachePath(key: string, format: string): string {
    return join(this.cacheDir, key.slice(0, 2), `${key}.${format}`);
  }

  private async readCache(file: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(file);
    } catch {
      return null; // 未命中（含目录还不存在）
    }
  }

  /** 先写临时文件再 rename：避免并发请求读到写了一半的 mp3 */
  private async writeCache(file: string, buffer: Buffer): Promise<void> {
    try {
      await fs.mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, buffer);
      await fs.rename(tmp, file);
    } catch (e) {
      // 缓存写失败不该让朗读失败，下次重新合成即可
      this.logger.warn(`写入朗读缓存失败：${(e as Error).message}`);
      return; // 没写进去就不算体积
    }
    await this.trimCache(buffer.length);
  }

  /**
   * 把目录压回上限以内。只在写盘后调用，属于冷路径——
   * 命中缓存压根走不到这里，所以可以放心做全盘扫描。
   */
  private async trimCache(addedBytes: number): Promise<void> {
    const prev = this.sweeping;
    const task = (async () => {
      if (prev) await prev.catch(() => {}); // 等上一轮清完再动手
      if (this.cacheBytes === null) {
        // 重启后首次写盘：刚写的这个文件已经在盘上了，扫出来的总量含它，不能再加一遍
        this.cacheBytes = await this.scanCache();
      } else {
        this.cacheBytes += addedBytes;
      }
      if (this.cacheBytes > this.cacheMaxBytes) await this.sweepCache();
    })();
    this.sweeping = task;
    await task.catch((e) =>
      this.logger.warn(`清理朗读缓存失败：${(e as Error).message}`),
    );
  }

  private async scanCache(): Promise<number> {
    return (await this.listCacheFiles()).reduce((sum, f) => sum + f.size, 0);
  }

  /**
   * 按 mtime 从旧到新删，直到回到上限以内。
   * 用 mtime 而不是访问次数：写入时间本身就代表「最近合成过」，
   * 而上次朗读是什么时候无关紧要——音频内容不会随时间变化。
   */
  private async sweepCache(): Promise<void> {
    const limit = this.cacheMaxBytes;
    const files = await this.listCacheFiles();
    files.sort((a, b) => a.mtime - b.mtime);

    let total = files.reduce((sum, f) => sum + f.size, 0);
    let removed = 0;
    for (const f of files) {
      if (total <= limit) break;
      if (await this.removeFile(f.path)) {
        total -= f.size;
        removed += 1;
      }
    }

    this.cacheBytes = total;
    if (removed) {
      const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
      this.logger.log(
        `朗读缓存超限，已清理 ${removed} 个文件（现 ${mb(total)}MB，上限 ${mb(limit)}MB）`,
      );
    }
  }

  /** 删不掉（文件被占用 / 已被删）跳过就好，一次失败不该卡住整轮清理 */
  private async removeFile(path: string): Promise<boolean> {
    try {
      await fs.unlink(path);
      return true;
    } catch {
      return false;
    }
  }

  /** 列出缓存里每个音频的大小与 mtime。目录只有 key 前 2 位这一层，不必递归。 */
  private async listCacheFiles(): Promise<CacheFile[]> {
    let shards: string[];
    try {
      shards = await fs.readdir(this.cacheDir);
    } catch {
      return []; // 目录还不存在
    }

    const out: CacheFile[] = [];
    for (const shard of shards) {
      const sub = join(this.cacheDir, shard);
      const names = await fs.readdir(sub).catch(() => []);
      const stats = await Promise.all(
        names
          // .tmp 是正在写的临时文件，删掉会让紧接着的 rename 失败
          .filter((n) => !n.endsWith('.tmp'))
          .map(async (name): Promise<CacheFile | null> => {
            const path = join(sub, name);
            const stat = await fs.stat(path).catch(() => null);
            return stat ? { path, size: stat.size, mtime: stat.mtimeMs } : null;
          }),
      );
      for (const s of stats) if (s) out.push(s);
    }
    return out;
  }

  private get config(): Omit<SynthParams, 'text'> {
    const rate = Number(process.env.TTS_RATE);
    return {
      model: process.env.TTS_MODEL || DEFAULT_MODEL,
      voice: process.env.TTS_VOICE || DEFAULT_VOICE,
      rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
      format: process.env.TTS_FORMAT || DEFAULT_FORMAT,
      language: process.env.TTS_LANGUAGE || DEFAULT_LANGUAGE,
    };
  }

  /** 百炼错误 → Nest 异常。只回传 provider 的 message/code。 */
  private mapError(e: any): Error {
    const status = e?.response?.status;
    const detail =
      e?.response?.data?.message ||
      e?.response?.data?.code ||
      e?.message ||
      '未知错误';

    if (status === 400 || status === 422) {
      return new BadRequestException(`朗读失败：${detail}`);
    }
    if (status === 401 || status === 403) {
      // Key 失效 / 地域或音色与模型不匹配 —— 服务端配置问题，不向用户暴露细节
      return new ServiceUnavailableException('朗读服务鉴权失败');
    }
    if (status === 429) {
      return new ServiceUnavailableException('朗读服务繁忙，请稍后重试');
    }
    if (e?.code === 'ECONNABORTED') {
      return new ServiceUnavailableException('朗读超时，请重试');
    }
    return new ServiceUnavailableException(`朗读失败：${detail}`);
  }
}
