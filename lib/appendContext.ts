/**
 * Helpers shared by the "add another source to an existing session" flows
 * (Loom append + PDF append).
 *
 * When a new Loom video or PDF is added to a session we analyze ONLY the new
 * material (the existing tasks and their screenshots are kept untouched — see
 * the plan). To stop the AI re-extracting work that's already in the session,
 * we hand it the list of existing task names as "do not duplicate" context.
 * This rides along in the `dbContext` string that every analyzer already
 * concatenates into its prompt, so no analyzer signature changes are needed.
 */

interface ExistingTaskLike {
  task_name?: string
  task_description?: string
}

/**
 * Render the already-extracted tasks as a prompt block telling the AI to skip
 * anything it has already covered. Returns '' when there are no existing tasks
 * (e.g. a corrupt/empty payload) so callers can safely concatenate it.
 */
export function buildExistingTasksContext(existingTasks: ExistingTaskLike[]): string {
  const names = (existingTasks || [])
    .map(t => (t?.task_name || '').trim())
    .filter(Boolean)
  if (names.length === 0) return ''

  const list = names.map((n, i) => `${i + 1}. ${n}`).join('\n')
  return [
    '=== ALREADY-EXTRACTED TASKS (DO NOT RE-CREATE THESE) ===',
    'This material is being ADDED to an existing session that already contains',
    'the tasks below. Only return NEW tasks that the new material introduces.',
    'Do not duplicate, rephrase, or re-list any task already covered here:',
    list,
    '=== END ALREADY-EXTRACTED TASKS ===',
  ].join('\n')
}

/**
 * Append the existing-tasks block to a DB-context string, keeping a blank line
 * between them. Either argument may be empty.
 */
export function withExistingTasksContext(dbContext: string, existingTasks: ExistingTaskLike[]): string {
  const block = buildExistingTasksContext(existingTasks)
  if (!block) return dbContext
  return dbContext ? `${dbContext}\n\n${block}` : block
}
