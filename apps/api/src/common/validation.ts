import { BadRequestException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { isUUID, validate, type ValidationError } from 'class-validator';
import { businessMessage } from '../../../shared/src/messages.js';

export function validateUuid(value: string, field: string): void {
  if (!isUUID(value))
    throw new BadRequestException(businessMessage('VALIDATION_FAILED', { fields: field }));
}

export function invalidDto(errors: ValidationError[]): BadRequestException {
  const fields = (items: ValidationError[], prefix = ''): string[] =>
    items.flatMap((error) => {
      const property = prefix ? `${prefix}.${error.property}` : error.property;
      return [...(error.constraints ? [property] : []), ...fields(error.children ?? [], property)];
    });

  return new BadRequestException(
    businessMessage('VALIDATION_FAILED', {
      fields: [...new Set(fields(errors))].sort().join(', '),
    }),
  );
}

/** The Agent boundary uses the same DTO validation as HTTP controllers. */
export async function validateDto<T extends object>(
  type: ClassConstructor<T>,
  value: unknown,
): Promise<T> {
  const dto = plainToInstance(type, value);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errors.length) throw invalidDto(errors);

  return dto;
}
