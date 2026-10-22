import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  ValidateIf,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { DOWNLOAD_MODES, type DownloadMode } from '../../../../shared/src/contracts.js';

export class ParseMediaDto {
  @IsString() @MaxLength(4096) url!: string;
}

export class CreateDownloadDto {
  @IsUUID() mediaId!: string;
  @IsIn(DOWNLOAD_MODES) mode!: DownloadMode;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  formatId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  audioTrackId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  audioFormatId?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['srt', 'source']) subtitleFormat?:
    'srt' | 'source';
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  subtitles?: string[];
}

export class TaskActionDto {
  @IsIn(['pause', 'resume', 'retry', 'cancel']) action!: 'pause' | 'resume' | 'retry' | 'cancel';
}

export class ArchiveTaskDto {
  @IsBoolean() archived!: boolean;
}

export class RemoveTaskDto {
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() stopActive?: boolean;
}
export class ClearHistoryDto {
  @IsIn(['library', 'ended']) scope!: 'library' | 'ended';
}
export class RestoreHistoryDto {
  @IsUUID() backupId!: string;
}

export class DeleteDownloadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  taskIds!: string[];

  @IsIn([true]) confirmDelete!: boolean;
}

export class BinaryPathsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4096)
  'yt-dlp'?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(4096) ffmpeg?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4096)
  ffprobe?: string;
}

export class AccelerationDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(1) @Max(16) maxConnections!: number;
  @IsString() @MaxLength(4096) aria2Path!: string;
}

export class UpdatePreferencesDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  filenameTemplate?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['best', '2160', '1440', '1080', '720', '480', '360'])
  preferredQuality?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['system', 'zh-CN', 'en-US'])
  language?: 'system' | 'zh-CN' | 'en-US';
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['selected', 'auto']) cookieStrategy?:
    'selected' | 'auto';
  @ValidateIf((_object, value) => value !== undefined)
  @ValidateNested()
  @Type(() => AccelerationDto)
  acceleration?: AccelerationDto;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4096)
  downloadDirectory?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(4)
  concurrency?: number;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(16) fragments?: number;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(4096) proxy?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['', 'chrome', 'edge', 'firefox', 'safari', 'brave', 'chromium'])
  cookieBrowser?: '' | 'chrome' | 'edge' | 'firefox' | 'safari' | 'brave' | 'chromium';
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  cookieProfile?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4096)
  cookiesFile?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @ValidateNested()
  @Type(() => BinaryPathsDto)
  binaryPaths?: BinaryPathsDto;
}

export class InstallRuntimeDto {
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() force?: boolean;
  @IsArray() @IsIn(['yt-dlp', 'ffmpeg', 'ffprobe'], { each: true }) kinds!: (
    'yt-dlp' | 'ffmpeg' | 'ffprobe'
  )[];
}
