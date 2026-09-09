import { authenticatedFetch } from "@/lib/authenticatedFetch";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export interface AssignedGroup {
  id: string
  userId: string
  groupId: string
  startsAt: string
  expiresAt: string
  durationDays: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  group: {
    id: string
    name: string
    description: string
    agents: string[]
  }
}

interface AgentsByEmailResponse {
  email: string
  agents: string[]
  group?: { id: string; name: string; description: string | null }
}

export type AssignedAgentsResult = {
  agentKeys: string[]
  groups: AssignedGroup[]
};

/**
 * Every agent the user may open. Access comes from two independent sources --
 * the teams assigned to them and the agents assigned one by one in the admin
 * panel -- so both are merged here, and every caller reads the same answer.
 */
export async function fetchAssignedAgents(
  email: string,
  signal?: AbortSignal,
): Promise<AssignedAgentsResult> {
  const agentKeys = new Set<string>();
  let groups: AssignedGroup[] = [];

  const groupsRes = await authenticatedFetch(
    `${API_BASE}/admin/group-assignments?email=${encodeURIComponent(email)}&activeOnly=true`,
    { cache: "no-store", signal },
  );
  if (groupsRes.ok) {
    groups = (await groupsRes.json()) as AssignedGroup[];
    groups.forEach((assignment) => {
      assignment.group?.agents?.forEach((agent) => agentKeys.add(agent));
    });
  }

  // This endpoint responds with { email, agents: string[] }, not an array.
  const agentsRes = await authenticatedFetch(
    `${API_BASE}/admin/agents-by-email?email=${encodeURIComponent(email)}&activeOnly=true`,
    { cache: "no-store", signal },
  );
  if (agentsRes.ok) {
    const agentsData = (await agentsRes.json()) as AgentsByEmailResponse;
    if (Array.isArray(agentsData?.agents)) {
      agentsData.agents.forEach((agent) => agentKeys.add(agent));
    }
  }

  return { agentKeys: Array.from(agentKeys), groups };
}
