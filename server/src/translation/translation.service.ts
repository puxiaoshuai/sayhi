import { Injectable, BadRequestException } from '@nestjs/common';
import { LlmService } from '../common/llm.service';
import { extractJson } from '../common/json.util';

export interface VocabItem {
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
}

export interface PatternItem {
  pattern: string;
  explanation: string;
  example: string;
}

export interface AnalyzeResult {
  translation: string;
  vocabulary: VocabItem[];
  patterns: PatternItem[];
}

const SYSTEM_PROMPT = `你是一位资深英语外教，擅长把中文翻译成地道、自然的英语，并做适合中国学习者的拆解。
你必须且只能返回合法的 JSON，不要包含任何 markdown 标记或多余文本。JSON 结构：
{
  "translation": "地道的英文翻译（口语化、自然，避免中式英语和书面腔）",
  "vocabulary": [
    { "word": "重点单词或短语(英文)", "phonetic": "美式音标如 /həˈloʊ/", "pos": "词性缩写如 n./v./短语", "meaning": "中文释义" }
  ],
  "patterns": [
    { "pattern": "核心句型(英文结构，用 ... 表示可替换部分)", "explanation": "中文讲解该句型的用法", "example": "一个英文例句" }
  ]
}
要求：vocabulary 取 3~6 个最值得学的词/短语；patterns 取 1~3 个最核心的句型；没有合适内容时返回空数组，不要编造。`;

@Injectable()
export class TranslationService {
  constructor(private readonly llm: LlmService) {}

  async analyze(text: string): Promise<AnalyzeResult> {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      throw new BadRequestException('请输入要翻译的中文');
    }

    const raw = await this.llm.chatJsonWithRetry(
      SYSTEM_PROMPT,
      `请翻译并拆解这句话：${trimmed}`,
    );

    let parsed: Partial<AnalyzeResult>;
    try {
      parsed = extractJson<AnalyzeResult>(raw);
    } catch (e) {
      throw new BadRequestException('解析结果异常，请重试：' + e.message);
    }

    const translation = (parsed.translation || '').trim();
    if (!translation) {
      throw new BadRequestException('未能生成翻译，请重试');
    }

    return {
      translation,
      vocabulary: this.sanitizeVocab(parsed.vocabulary),
      patterns: this.sanitizePatterns(parsed.patterns),
    };
  }

  /** 字段级清洗：过滤缺关键字段的条目，避免前端渲染时出 undefined */
  private sanitizeVocab(list?: VocabItem[]): VocabItem[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter((v) => v && typeof v.word === 'string' && v.word.trim())
      .map((v) => ({
        word: String(v.word).trim(),
        phonetic: String(v.phonetic || '').trim(),
        pos: String(v.pos || '').trim(),
        meaning: String(v.meaning || '').trim(),
      }));
  }

  private sanitizePatterns(list?: PatternItem[]): PatternItem[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => p && typeof p.pattern === 'string' && p.pattern.trim())
      .map((p) => ({
        pattern: String(p.pattern).trim(),
        explanation: String(p.explanation || '').trim(),
        example: String(p.example || '').trim(),
      }));
  }
}
