// src/single-assigned-agent/single-assigned-agent.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentName,
  Prisma,
  SingleAssignedAgent,
  User,
} from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateSingleAssignedAgentDto,
  ListSingleAssignedAgentsQuery,
  UpdateSingleAssignedAgentDto,
} from './dto/single-assigned-agent.dto';

type Paginated<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const userSelect = {
  select: { id: true, email: true, oauthId: true, username: true },
} as const;

type AssignmentWithUser = Prisma.SingleAssignedAgentGetPayload<{
  include: { user: typeof userSelect };
}>;

/**
 * Plain CRUD over SingleAssignedAgent rows, addressed by id.
 *
 * The email-based assign/deactivate flows in AdminService stay the entry point
 * for the admin UI; this service is the row-level API behind them, so an
 * assignment can be inspected, edited and removed on its own.
 */
@Injectable()
export class SingleAssignedAgentService {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------- helpers ------------------------------- */

  private async resolveUser(sel: {
    email?: string;
    userId?: string;
  }): Promise<User> {
    if (sel.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: sel.userId },
      });
      if (!user) throw new NotFoundException(`User "${sel.userId}" not found`);
      return user;
    }
    const email = sel.email?.trim();
    if (!email) throw new BadRequestException('email or userId is required');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user)
      throw new NotFoundException(`User with email "${email}" not found`);
    return user;
  }

  /**
   * Explicit expiresAt wins (null clears it); otherwise durationDays is
   * counted from startsAt, falling back to the row's current start, then now.
   */
  private computeExpiry(
    startsAt: Date | undefined,
    expiresAt: Date | null | undefined,
    durationDays: number | null | undefined,
    currentStartsAt?: Date,
  ): Date | null | undefined {
    if (expiresAt !== undefined) return expiresAt;
    if (durationDays && durationDays > 0) {
      const base = new Date(startsAt ?? currentStartsAt ?? new Date());
      base.setUTCDate(base.getUTCDate() + durationDays);
      return base;
    }
    return undefined;
  }

  private tokensLeftFor(tokenLimit: number | null, usedTokens: number) {
    return tokenLimit === null ? null : Math.max(0, tokenLimit - usedTokens);
  }

  /**
   * Quota falls back to userAgentTokenUsage when no assignment grants the
   * agent, so revoking the last grant must not leave a spendable budget.
   */
  private async clearLegacyQuotaIfUnassigned(
    tx: Prisma.TransactionClient,
    userId: string,
    oauthId: string,
    agentName: AgentName,
  ) {
    const stillAssigned = await tx.singleAssignedAgent.findFirst({
      where: { userId, agentName, isActive: true },
      select: { id: true },
    });
    if (stillAssigned) return;
    await tx.userAgentTokenUsage.updateMany({
      where: { oauthId, agentName },
      data: { totalTokenLimit: 0, totalTokensLeft: 0 },
    });
  }

  private async getOrThrow(id: string): Promise<AssignmentWithUser> {
    if (!id?.trim()) throw new BadRequestException('Assignment id is required');
    const row = await this.prisma.singleAssignedAgent.findUnique({
      where: { id },
      include: { user: userSelect },
    });
    if (!row) throw new NotFoundException(`Agent assignment "${id}" not found`);
    return row;
  }

  /* -------------------------------- CREATE -------------------------------- */

  /**
   * Creates a new grant. One active row per (user, agent) is the invariant the
   * rest of the platform relies on, so a second active grant is refused
   * rather than silently merged — PATCH the existing one instead.
   */
  async create(dto: CreateSingleAssignedAgentDto): Promise<AssignmentWithUser> {
    const user = await this.resolveUser(dto);
    const isActive = dto.isActive ?? true;

    if (isActive) {
      const existing = await this.prisma.singleAssignedAgent.findFirst({
        where: { userId: user.id, agentName: dto.agentName, isActive: true },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `User ${user.email} already has an active ${dto.agentName} assignment (${existing.id})`,
        );
      }
    }

    const expiresAt = this.computeExpiry(
      dto.startsAt,
      dto.expiresAt,
      dto.durationDays,
    );
    const tokenLimit = dto.tokenLimit ?? null;

    return this.prisma.singleAssignedAgent.create({
      data: {
        userId: user.id,
        agentName: dto.agentName,
        ...(dto.startsAt ? { startsAt: dto.startsAt } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(dto.durationDays !== undefined
          ? { durationDays: dto.durationDays }
          : {}),
        isActive,
        tokenLimit,
        tokensLeft: this.tokensLeftFor(tokenLimit, 0),
      },
      include: { user: userSelect },
    });
  }

  /* --------------------------------- READ --------------------------------- */

  async findAll(
    q: ListSingleAssignedAgentsQuery,
  ): Promise<Paginated<AssignmentWithUser>> {
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const now = new Date();

    const where: Prisma.SingleAssignedAgentWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.email ? { user: { email: q.email.trim() } } : {}),
      ...(q.agentName ? { agentName: q.agentName } : {}),
      ...(typeof q.isActive === 'boolean' ? { isActive: q.isActive } : {}),
      ...(q.activeOnly
        ? {
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.singleAssignedAgent.findMany({
        where,
        include: { user: userSelect },
        orderBy: { [q.sortBy ?? 'createdAt']: q.sortOrder ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.singleAssignedAgent.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findOne(id: string): Promise<AssignmentWithUser> {
    return this.getOrThrow(id);
  }

  /* -------------------------------- UPDATE -------------------------------- */

  async update(
    id: string,
    dto: UpdateSingleAssignedAgentDto,
  ): Promise<AssignmentWithUser> {
    const existing = await this.getOrThrow(id);

    const expiresAt = this.computeExpiry(
      dto.startsAt,
      dto.expiresAt,
      dto.durationDays,
      existing.startsAt,
    );

    const data: Prisma.SingleAssignedAgentUpdateInput = {
      ...(dto.startsAt ? { startsAt: dto.startsAt } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(dto.durationDays !== undefined
        ? { durationDays: dto.durationDays }
        : {}),
      ...(typeof dto.isActive === 'boolean' ? { isActive: dto.isActive } : {}),
    };

    if (dto.tokenLimit !== undefined) {
      data.tokenLimit = dto.tokenLimit;
      data.tokensLeft = this.tokensLeftFor(dto.tokenLimit, existing.usedTokens);
    }

    // Re-activating must not create a second active grant for the same agent.
    if (dto.isActive === true && !existing.isActive) {
      const clash = await this.prisma.singleAssignedAgent.findFirst({
        where: {
          userId: existing.userId,
          agentName: existing.agentName,
          isActive: true,
          NOT: { id },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `User ${existing.user.email} already has an active ${existing.agentName} assignment (${clash.id})`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.singleAssignedAgent.update({
        where: { id },
        data,
        include: { user: userSelect },
      });

      if (dto.isActive === false && existing.isActive) {
        await this.clearLegacyQuotaIfUnassigned(
          tx,
          existing.userId,
          existing.user.oauthId,
          existing.agentName,
        );
      }

      return updated;
    });
  }

  /* -------------------------------- DELETE -------------------------------- */

  async remove(id: string): Promise<{ deleted: true; id: string }> {
    const existing = await this.getOrThrow(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.singleAssignedAgent.delete({ where: { id } });
      await this.clearLegacyQuotaIfUnassigned(
        tx,
        existing.userId,
        existing.user.oauthId,
        existing.agentName,
      );
    });

    return { deleted: true, id };
  }
}

export type { AssignmentWithUser, SingleAssignedAgent };
