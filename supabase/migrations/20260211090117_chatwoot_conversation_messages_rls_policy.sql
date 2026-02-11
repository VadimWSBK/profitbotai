-- chatwoot_conversation_messages: RLS enabled but had no policies (security advisor).
-- Table is accessed only via service role (webhook, API). Add explicit policy:
-- authenticated users with workspace access to the agent can read their agent's messages.
-- Service role bypasses RLS; anon gets nothing by default.

-- Allow workspace members to SELECT messages for agents in their workspace
CREATE POLICY "Workspace members can read chatwoot messages"
ON public.chatwoot_conversation_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.agents a
    JOIN public.team_members tm ON tm.workspace_id = a.workspace_id AND tm.user_id = auth.uid()
    WHERE a.id = chatwoot_conversation_messages.agent_id
  )
);

-- Insert/update/delete: service role only (webhook). No policy for authenticated = deny.
