import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NativeService } from './native.service.js';
import { SystemService } from './system.service.js';
import { JournalService } from './journal.service.js';
import {
  BrowserProfilesDto,
  ImportBrowserProfilesDto,
  NativeRequestDto,
  NativeResultDto,
  OpenFileDto,
  ProxyTestDto,
} from './system.dto.js';

@Controller('system')
export class SystemController {
  constructor(
    private readonly native: NativeService,
    private readonly system: SystemService,
    private readonly journal: JournalService,
  ) {}

  @Get('disk') disk() {
    return this.system.diskSpace();
  }
  @Get('browser-profiles') profiles(@Query() dto: BrowserProfilesDto) {
    return this.system.browserProfiles(dto.browser);
  }
  @Post('browser-profiles') importProfiles(@Body() dto: ImportBrowserProfilesDto) {
    return this.system.importBrowserProfiles(dto);
  }
  @Get('diagnostics') diagnostics(@Query('force') force?: string) {
    return this.system.diagnostics(force === 'true');
  }
  @Post('proxy-test') proxy(@Body() dto: ProxyTestDto) {
    return this.system.proxyTest(dto.proxy, dto.url);
  }
  @Post('open') open(@Body() dto: OpenFileDto) {
    return this.system.open(dto.target, dto.taskId, dto.index);
  }
  @Get('error-report') report(@Query('taskId') taskId?: string) {
    return this.system.errorReport(taskId);
  }
  @Get('logs') logs() {
    return this.journal.read();
  }
  @Post('logs/clear') clearLogs() {
    return this.journal.clear();
  }
  @Post('native') request(@Body() dto: NativeRequestDto) {
    return this.native.create(dto.kind, dto.purpose, dto.text);
  }
  @Get('native') pending() {
    return { requests: this.native.pending() };
  }
  @Get('native/:id') result(@Param('id') id: string) {
    return this.native.get(id);
  }
  @Post('native/:id') complete(@Param('id') id: string, @Body() dto: NativeResultDto) {
    return this.native.complete(id, dto.value, dto.cancelled);
  }
}
