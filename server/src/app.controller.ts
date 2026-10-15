import { Controller, Get } from '@nestjs/common';

/**
 * 部署探活：后端起来后，浏览器直接打开 https://域名/api/hi 看到 hello world，
 * 就说明服务活着、Nginx 反代和 HTTPS 都通了（见 命令.md §5）。
 */
@Controller()
export class AppController {
  @Get('hi')
  hi() {
    return 'hello world';
  }
}
