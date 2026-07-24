-- Release-candidate hardening: Increment K replaces claim_ai_job to extend its
-- return contract. DROP/CREATE restores PostgreSQL's default PUBLIC EXECUTE,
-- so reassert the private worker boundary after the replacement.
--
-- The migration runner is deliberately not the final constrained function
-- owner. Use a transaction-scoped SET-capable membership issued by this
-- runner, perform the ACL change as the owner, then remove only that grant.
grant odiina_ai_worker_api to postgres with set true;
set role odiina_ai_worker_api;
revoke all on function app.claim_ai_job(integer) from public, anon;
grant execute on function app.claim_ai_job(integer) to authenticated;
reset role;
revoke odiina_ai_worker_api from postgres granted by postgres;
