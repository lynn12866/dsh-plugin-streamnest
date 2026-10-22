import { BusinessError } from '../../../shared/src/messages.js';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { MediaService } from './media.service.js';
import { ThumbnailService } from './thumbnail.service.js';
import { RuntimeService } from '../runtime/runtime.service.js';
import { playableArtifactIndex } from '../../../shared/src/media-files.js';
import { businessMessage } from '../../../shared/src/messages.js';
import { NotFoundException } from '@nestjs/common';
import {
  ArchiveTaskDto,
  CreateDownloadDto,
  RemoveTaskDto,
  ClearHistoryDto,
  RestoreHistoryDto,
  DeleteDownloadsDto,
  InstallRuntimeDto,
  ParseMediaDto,
  TaskActionDto,
  UpdatePreferencesDto,
} from './dto/media.dto.js';

@Controller()
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly runtime: RuntimeService,
    private readonly thumbnails: ThumbnailService,
  ) {}

  @Get('media/:id/thumbnail') async thumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort(new BusinessError('THUMBNAIL_CANCELLED'));
    };
    response.once('close', disconnect);
    try {
      const image = await this.thumbnails.get(id, this.media.preferences(), controller.signal);
      response.type(image.type).set('Cache-Control', 'private, max-age=300').send(image.body);
    } finally {
      response.removeListener('close', disconnect);
    }
  }

  @Get('preferences') preferences() {
    return this.media.preferences();
  }

  @Get('tasks/:id/thumbnail') async taskThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const task = this.media.get(id);
    const index = playableArtifactIndex(task);
    if (task.state !== 'completed' || task.request.mode !== 'video' || index < 0)
      throw new NotFoundException(businessMessage('ARTIFACT_NOT_FOUND'));

    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort(new BusinessError('THUMBNAIL_CANCELLED'));
    };
    response.once('close', disconnect);
    try {
      const file = await this.media.artifact(id, index);
      const image = await this.thumbnails.getTask(
        id,
        file.path,
        this.media.preferences(),
        controller.signal,
      );
      response.type('image/jpeg').set('Cache-Control', 'private, max-age=300').send(image);
    } finally {
      response.removeListener('close', disconnect);
    }
  }

  @Post('library/sync') async syncDirectory(@Res({ passthrough: true }) response: Response) {
    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort(new BusinessError('DIRECTORY_SYNC_CANCELLED'));
    };
    response.once('close', disconnect);
    try {
      return await this.media.syncDirectory(controller.signal);
    } finally {
      response.removeListener('close', disconnect);
    }
  }

  @Post('library/delete') async deleteDownloads(
    @Body() dto: DeleteDownloadsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort(new BusinessError('DELETE_CANCELLED'));
    };
    response.once('close', disconnect);
    try {
      return await this.media.deleteDownloads(dto, controller.signal);
    } finally {
      response.removeListener('close', disconnect);
    }
  }
  @Patch('preferences') updatePreferences(@Body() dto: UpdatePreferencesDto) {
    return this.media.updatePreferences(dto);
  }

  @Post('parse') async parse(
    @Body() dto: ParseMediaDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort(new BusinessError('PARSE_CANCELLED'));
    };
    response.once('close', disconnect);
    try {
      return await this.media.parse(dto.url, controller.signal);
    } finally {
      response.removeListener('close', disconnect);
    }
  }

  @Get('tasks') tasks(
    @Query('scope') scope?: string,
    @Query('query') query?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('archived') archived?: string,
  ) {
    return this.media.list({
      scope,
      query,
      offset: offset === undefined ? undefined : Number(offset),
      limit: limit === undefined ? undefined : Number(limit),
      archived: archived === undefined ? undefined : archived === 'true',
    });
  }
  @Get('tasks/:id') task(@Param('id') id: string) {
    return this.media.get(id);
  }
  @Post('tasks') create(@Body() dto: CreateDownloadDto) {
    return this.media.enqueue(dto);
  }
  @Post('tasks/:id/action') action(@Param('id') id: string, @Body() dto: TaskActionDto) {
    return this.media.action(id, dto.action);
  }
  @Patch('tasks/:id/archive') archive(@Param('id') id: string, @Body() dto: ArchiveTaskDto) {
    return this.media.archive(id, dto.archived);
  }
  @Get('tasks/:id/files/:index') async file(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() response: Response,
  ) {
    const artifact = await this.media.artifact(id, index);
    response.download(artifact.path, artifact.name);
  }

  @Post('tasks/:id/remove') remove(@Param('id') id: string, @Body() dto: RemoveTaskDto) {
    return this.media.remove(id, dto.stopActive);
  }
  @Post('history/clear') clear(@Body() dto: ClearHistoryDto) {
    return this.media.clearHistory(dto.scope);
  }
  @Post('history/restore') restore(@Body() dto: RestoreHistoryDto) {
    return this.media.restoreHistory(dto.backupId);
  }

  @Get('runtime') async runtimeStatus(@Query('force') force?: string) {
    return {
      status: await this.runtime.status(this.media.preferences(), undefined, force === 'true'),
      installation: this.runtime.progress(),
    };
  }
  @Post('runtime/install') install(@Body() dto: InstallRuntimeDto) {
    return this.runtime.install(dto.kinds, this.media.preferences(), dto.force);
  }
  @Post('runtime/cancel') cancelInstall() {
    return this.runtime.cancelInstall();
  }
}
