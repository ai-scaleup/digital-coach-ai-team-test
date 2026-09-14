// src/single-assigned-agent/single-assigned-agent.module.ts
import { Module } from '@nestjs/common';
import { SingleAssignedAgentController } from './single-assigned-agent.controller';
import { SingleAssignedAgentService } from './single-assigned-agent.service';

// TEMPORARY: no AuthMiddleware here, and the route group is listed in
// auth/public-routes.ts so the global middleware lets it through as well.
// Re-apply AuthMiddleware (see MembershipModule) before this ships.
@Module({
  // PrismaModule is global; re-providing PrismaService here would open a
  // second connection pool.
  controllers: [SingleAssignedAgentController],
  providers: [SingleAssignedAgentService],
  exports: [SingleAssignedAgentService],
})
export class SingleAssignedAgentModule {}
