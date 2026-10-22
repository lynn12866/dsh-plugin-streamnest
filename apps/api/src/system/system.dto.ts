import {
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NATIVE_KINDS, type NativeKind } from '../../../shared/src/system.js';
import type { OpenTarget } from './system.service.js';

export class BrowserProfilesDto {
  @IsIn(['chrome', 'edge', 'firefox', 'safari', 'brave', 'chromium'])
  browser!: 'chrome' | 'edge' | 'firefox' | 'safari' | 'brave' | 'chromium';
}
class BrowserAccountDto {
  @IsString() @MaxLength(100) id!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsString() @MaxLength(300) account!: string;
}
export class ImportBrowserProfilesDto extends BrowserProfilesDto {
  @IsString() @MaxLength(4096) sourcePath!: string;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BrowserAccountDto)
  profiles!: BrowserAccountDto[];
}

export class NativeRequestDto {
  @IsIn(NATIVE_KINDS) kind!: NativeKind;
  @IsString() @MaxLength(300) purpose!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(4096) text?: string;
}
export class NativeResultDto {
  @IsString() @MaxLength(4096) value!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() cancelled?: boolean;
}
export class ProxyTestDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(4096) proxy?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(4096) url?: string;
}
export class OpenFileDto {
  @IsIn(['artifact', 'reveal', 'task-folder', 'download-directory', 'runtime', 'logs'])
  target!: OpenTarget;
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() taskId?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(1000) index?: number;
}
