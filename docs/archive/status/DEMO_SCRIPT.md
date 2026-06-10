# Demo Script

Use this for a 10 to 15 minute controlled demo. Keep a seeded demo tenant and users ready before starting.

## Setup

- Browser opened to the app.
- Admin account available.
- Demo tenant active.
- At least one normal user available.
- A small valid upload file available, such as `smoke.txt`.

## Flow

1. Login as admin.
   - Show the tenant-aware header and current tenant context.

2. Show tenant and workspace.
   - Open the main workspace list.
   - Show that the app is organized around a tenant, workspace, group, and channel structure.

3. Invite user.
   - Open `/tenant-admin`.
   - Show tenant users and invite/add a user according to the available pilot setup.

4. Create group.
   - Create or open a group under the demo workspace.

5. Create project.
   - Create a project inside the workspace/group.

6. Create task.
   - Add a task with a due date and priority.

7. Assign member.
   - Add the demo member to the project and assign the task.

8. Send DM.
   - Create a direct conversation with the member.
   - Send a short message.

9. Upload artifact.
   - Create an artifact for the project.
   - Upload a valid artifact version.

10. Show Gantt.
    - Open the project Gantt view or call `GET /api/projects/{projectId}/gantt`.

11. Show notification.
    - Open notifications and show unread/read behavior.

12. Show audit log.
    - Open tenant audit logs as a tenant admin.
    - Explain that normal users cannot view audit logs.

13. Show tenant settings and usage.
    - Open `/tenant-admin`.
    - Show storage, user, project, quota, feature, and settings summaries.

14. Mention future UI support.
    - Radial menu, richer docking, and streaming/live collaboration support are future work. The registry foundation exists, but the full experiences are not implemented.

15. Known limitations.
    - No E2EE, voice/video, live streaming, full billing, advanced SSO, full-text search engine, complete object storage adapter, full restore, or broad production SaaS readiness yet.

## Close

Recommended message: the app is suitable for a controlled local demo or internal pilot when the manual smoke test and backup rehearsal pass. It is not ready for broad SaaS production.
