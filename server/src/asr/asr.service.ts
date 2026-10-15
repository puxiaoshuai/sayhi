import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

/**
 * 阿里云百炼（DashScope）语音识别封装（见技术方案 6.5）。
 * API Key 只存在于后端环境变量中，小程序端永不接触（见技术方案 6.2）。
 *
 * 采用非实时同步调用：整段音频一次性送入，返回整段文本。
 * 音频以 Base64 Data URI 传入，免去把用户录音暴露到公网对象存储。
 */

/** 格式 → Data URI 的 MIME 类型，必须与 format 匹配，否则百炼报 400 */
const MIME_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  amr: 'audio/amr',
  pcm: 'audio/pcm',
};

export interface AsrResult {
  text: string;
  duration?: number;
  requestId?: string;
}

@Injectable()
export class AsrService {
  async transcribe(
    audio: string,
    format = 'mp3',
    languageHints?: string[],
  ): Promise<AsrResult> {
    const baseUrl = process.env.ASR_BASE_URL;
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model = process.env.ASR_MODEL || 'qwen-audio-3.1-asr-flash';
    if (!baseUrl || !apiKey) {
      throw new ServiceUnavailableException('语音识别服务未配置');
    }

    // 清洗：客户端可能带 data: 前缀，统一剥掉；顺带去掉可能的换行/空白
    const bare = (audio || '')
      .replace(/^data:[^;]+;base64,/i, '')
      .replace(/\s+/g, '');
    if (!bare) {
      throw new BadRequestException('音频数据不能为空');
    }
    const mime = MIME_BY_FORMAT[format] || 'audio/mpeg';
    const dataUri = `data:${mime};base64,${bare}`;

    const parameters: Record<string, unknown> = { format };
    // mp3/wav 等容器自带采样率；裸 PCM 没有头信息，必须显式指定
    if (format === 'pcm') parameters.sample_rate = '16000';
    if (languageHints?.length) {
      parameters.language_hints = languageHints.slice(0, 4);
    }

    try {
      const res = await axios.post(
        `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
        {
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'input_audio', input_audio: { data: dataUri } },
                ],
              },
            ],
          },
          parameters,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-SSE': 'disable', // 显式关闭流式，取一次性结果
          },
          timeout: 120_000, // 录音 ≤60s，模型推理留足余量
        },
      );

      const text = this.extractText(res.data);
      if (!text) {
        throw new BadRequestException('没能听清，请再说一次');
      }
      return {
        text,
        duration: res.data?.usage?.duration,
        requestId: res.data?.request_id,
      };
    } catch (e) {
      // 上面主动抛的业务异常（如空结果）原样透出
      if (e instanceof BadRequestException) throw e;
      throw this.mapError(e);
    }
  }

  /** 识别文本在 output.text；对文档描述的其他形态做防御性兜底 */
  private extractText(data: any): string {
    const direct = data?.output?.text;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();

    const content = data?.output?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((c) => (typeof c === 'string' ? c : c?.text || ''))
        .join('')
        .trim();
    }
    return '';
  }

  /**
   * 百炼错误 → Nest 异常。
   * 只回传 provider 的 message/code，绝不把 audio / dataUri 带进异常或日志。
   */
  private mapError(e: any): Error {
    const status = e?.response?.status;
    const detail =
      e?.response?.data?.message ||
      e?.response?.data?.code ||
      e?.message ||
      '未知错误';

    if (status === 400 || status === 422) {
      return new BadRequestException(`音频无法识别：${detail}`);
    }
    if (status === 401 || status === 403) {
      // Key 失效 / 地域或 WorkspaceId 不匹配 —— 服务端配置问题，不向用户暴露细节
      return new ServiceUnavailableException('语音识别服务鉴权失败');
    }
    if (status === 429) {
      return new ServiceUnavailableException('语音识别服务繁忙，请稍后重试');
    }
    if (e?.code === 'ECONNABORTED') {
      return new ServiceUnavailableException('语音识别超时，请重试');
    }
    return new ServiceUnavailableException(`语音识别失败：${detail}`);
  }
}
