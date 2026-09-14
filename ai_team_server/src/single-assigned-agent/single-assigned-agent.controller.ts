// src/single-assigned-agent/single-assigned-agent.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AgentName } from 'src/generated/prisma/client';
import {
  CreateSingleAssignedAgentDto,
  ListSingleAssignedAgentsQuery,
  UpdateSingleAssignedAgentDto,
} from './dto/single-assigned-agent.dto';
import { SingleAssignedAgentService } from './single-assigned-agent.service';

const timingSchema = {
  startsAt: { type: 'string', format: 'date-time' },
  expiresAt: { type: 'string', format: 'date-time', nullable: true },
  durationDays: { type: 'integer', minimum: 1, example: 30 },
  isActive: { type: 'boolean', example: true },
  tokenLimit: {
    type: 'integer',
    minimum: 0,
    nullable: true,
    example: 50000,
    description: 'Null/omitted = access only, no allowance on this grant',
  },
};

const assignmentResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    agentName: { type: 'string', enum: Object.values(AgentName) },
    startsAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    durationDays: { type: 'integer', nullable: true },
    isActive: { type: 'boolean' },
    tokenLimit: {
      type: 'integer',
      nullable: true,
      description: 'Allowance carried by this grant; null = access only',
    },
    usedTokens: { type: 'integer', description: 'Rollup of total spend' },
    inputTokens: { type: 'integer', description: 'Rollup of prompt tokens' },
    outputTokens: { type: 'integer', description: 'Rollup of completion tokens' },
    tokensLeft: {
      type: 'integer',
      nullable: true,
      description: 'max(0, tokenLimit - usedTokens); null when tokenLimit is null',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    user: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        oauthId: { type: 'string' },
        username: { type: 'string', nullable: true },
      },
    },
  },
  example: {
    id: '5b0c2e7e-3d4f-4b7a-9c1e-2f6a8d9b0c11',
    userId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    agentName: 'JIM',
    startsAt: '2026-09-11T00:00:00.000Z',
    expiresAt: '2026-10-11T00:00:00.000Z',
    durationDays: 30,
    isActive: true,
    tokenLimit: 50000,
    usedTokens: 1200,
    inputTokens: 800,
    outputTokens: 400,
    tokensLeft: 48800,
    createdAt: '2026-09-11T09:15:00.000Z',
    updatedAt: '2026-09-11T09:15:00.000Z',
    user: {
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      email: 'user@example.com',
      oauthId: 'user_2abcDEFghiJKL',
      username: 'Mario Rossi',
    },
  },
};

const paginatedResponseSchema = {
  type: 'object',
  properties: {
    data: { type: 'array', items: assignmentResponseSchema },
    total: { type: 'integer', example: 42 },
    page: { type: 'integer', example: 1 },
    limit: { type: 'integer', example: 50 },
    totalPages: { type: 'integer', example: 1 },
  },
};

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@ApiTags('agent-assignments')
// TEMPORARY: overrides the document-wide security requirements with an empty
// list so Swagger shows these operations as open (no lock icon).
@ApiSecurity({})
@Controller('admin/agent-assignments')
export class SingleAssignedAgentController {
  constructor(private readonly service: SingleAssignedAgentService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a single agent assignment',
    description:
      'Target the user by `email` or `userId`. Refused with 409 if the user already holds an active grant for the agent — PATCH that one instead.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['agentName'],
      properties: {
        email: { type: 'string', format: 'email' },
        userId: { type: 'string', format: 'uuid' },
        agentName: { type: 'string', enum: Object.values(AgentName) },
        ...timingSchema,
      },
      example: {
        email: 'user@example.com',
        agentName: 'JIM',
        durationDays: 30,
        tokenLimit: 50000,
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Assignment created',
    schema: assignmentResponseSchema,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, or neither email nor userId supplied',
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({ description: 'Active assignment already exists' })
  create(@Body() dto: CreateSingleAssignedAgentDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List single agent assignments (paginated)' })
  @ApiQuery({ name: 'email', required: false, format: 'email' })
  @ApiQuery({ name: 'userId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'agentName', required: false, enum: Object.values(AgentName) })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    type: Boolean,
    description: 'isActive AND not expired',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'updatedAt', 'startsAt', 'expiresAt', 'agentName'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({
    description: 'Assignments returned',
    schema: paginatedResponseSchema,
  })
  findAll(@Query() q: ListSingleAssignedAgentsQuery) {
    return this.service.findAll(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single agent assignment by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Assignment returned',
    schema: assignmentResponseSchema,
  })
  @ApiNotFoundResponse({ description: 'Assignment not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a single agent assignment',
    description:
      'Every field is optional. `expiresAt` (null clears) beats `durationDays`. Changing `tokenLimit` re-derives `tokensLeft` from `usedTokens`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: timingSchema,
      example: { expiresAt: '2026-12-31T23:59:59.000Z', tokenLimit: 80000 },
    },
  })
  @ApiOkResponse({
    description: 'Assignment updated',
    schema: assignmentResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Assignment not found' })
  @ApiConflictResponse({
    description: 'Re-activating would create a second active grant',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSingleAssignedAgentDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a single agent assignment' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Assignment deleted',
    schema: {
      type: 'object',
      properties: {
        deleted: { type: 'boolean', example: true },
        id: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Assignment not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
