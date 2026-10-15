import { Injectable, HttpException, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';

/**
 * DeepSeek（OpenAI 兼容格式）调用封装。
 * API Key 只存在于后端环境变量中，小程序端永不接触（见技术方案 6.2）。
 */
@Injectable()
export class LlmService {
  /**
   * 以 JSON 模式对话。DeepSeek 支持 response_format=json_object，
   * 配合 System Prompt 的"只返回 JSON"约束，稳定性远高于裸文本模式；
   * 调用方仍应使用 extractJson 做清洗兜底（见技术方案 6.1）。
   */
  async chatJson(systemPrompt: string, userPrompt: string): Promise<string> {
    const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

    try {
      const res = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.5, // 低温度保证结构化输出稳定
          max_tokens: 3000,
          response_format: { type: 'json_object' },
        },
        {
          headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
          timeout: 60_000,
        },
      );
      return res.data?.choices?.[0]?.message?.content as string;
    } catch (e) {
      const detail = e.response?.data?.error?.message || e.message;
      throw new ServiceUnavailableException(`大模型调用失败：${detail}`);
    }
  }

  /** 带一次重试的 JSON 对话（清洗/解析失败时重试一次） */
  async chatJsonWithRetry(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    try {
      return await this.chatJson(systemPrompt, userPrompt);
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() >= 500) {
        return await this.chatJson(systemPrompt, userPrompt);
      }
      throw e;
    }
  }
}
