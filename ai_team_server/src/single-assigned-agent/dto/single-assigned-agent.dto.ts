// src/single-assigned-agent/dto/single-assigned-agent.dto.ts
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AgentName } from 'src/generated/prisma/client';

/* ------------------------- helpers for transforms ------------------------- */
const toNumber = ({ value }: { value: any }) => {
  if (value === '' || value === undefined || value === null) return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isNaN(n) ? undefined : n;
};

/** Allows number | null | undefined; maps '' -> undefined, null -> null */
const toNumberOrNull = ({ value }: { value: any }) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isNaN(n) ? undefined : n;
};

const toDate = ({ value }: { value: any }) => {
  if (value === '' || value === undefined || value === null) return undefined;
  return new Date(value);
};

/** Allows Date | string | null | undefined; maps '' -> undefined, null -> null */
const toDateOrNull = ({ value }: { value: any }) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
};

const toBool = ({ value }: { value: any }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value === 'true';
  return Boolean(value);
};

/* --------------------------------- CREATE --------------------------------- */

/**
 * The target user is picked by either `email` or `userId`; exactly one is
 * required. Timing follows the same rules as the other assignment paths: an
 * explicit `expiresAt` wins over `durationDays`, and `durationDays` alone is
 * counted from `startsAt` (or now).
 */
export class CreateSingleAssignedAgentDto {
  @ValidateIf((o) => !o.userId)
  @IsEmail()
  email?: string;

  @ValidateIf((o) => !o.email)
  @IsUUID()
  userId?: string;

  @IsEnum(AgentName)
  agentName!: AgentName;

  @IsOptional()
  @Transform(toDate)
  startsAt?: Date;

  @IsOptional()
  @ValidateIf((o) => o.expiresAt !== null)
  @Transform(toDateOrNull)
  expiresAt?: Date | null;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Token allowance carried by this direct grant. Null/omitted = access only. */
  @IsOptional()
  @ValidateIf((o) => o.tokenLimit !== null)
  @Transform(toNumberOrNull)
  @IsInt()
  @Min(0)
  tokenLimit?: number | null;
}

/* --------------------------------- UPDATE --------------------------------- */

export class UpdateSingleAssignedAgentDto {
  @IsOptional()
  @Transform(toDate)
  startsAt?: Date;

  @IsOptional()
  @ValidateIf((o) => o.expiresAt !== null)
  @Transform(toDateOrNull)
  expiresAt?: Date | null;

  @IsOptional()
  @ValidateIf((o) => o.durationDays !== null)
  @Transform(toNumberOrNull)
  @IsInt()
  @Min(1)
  durationDays?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Setting a new limit re-derives `tokensLeft` from the grant's `usedTokens`.
   * Null clears the allowance (and `tokensLeft`) so the grant is access only.
   */
  @IsOptional()
  @ValidateIf((o) => o.tokenLimit !== null)
  @Transform(toNumberOrNull)
  @IsInt()
  @Min(0)
  tokenLimit?: number | null;
}

/* ---------------------------------- LIST ---------------------------------- */

export class ListSingleAssignedAgentsQuery {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(AgentName)
  agentName?: AgentName;

  /** Filter on the stored flag only. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  /** isActive = true AND not expired. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'startsAt', 'expiresAt', 'agentName'])
  sortBy?: 'createdAt' | 'updatedAt' | 'startsAt' | 'expiresAt' | 'agentName';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
