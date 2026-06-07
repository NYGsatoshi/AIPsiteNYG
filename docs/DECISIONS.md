# Decisions

## ASP.NET Core / C#

Decision: build the application as an ASP.NET Core / C# web app.

Reason: the repository already uses this stack, and it fits a maintainable school operations platform with server-managed authorization.

## PostgreSQL

Decision: use PostgreSQL as the primary database.

Reason: it supports relational membership and authorization models, indexing, JSON metadata where needed, and simple text search for MVP.

## Modular Monolith

Decision: keep one deployable app organized by modules.

Reason: the first target is about 100 users, and module folders provide enough separation without microservice overhead.

## Server-Managed DM First

Decision: direct messages use server-managed conversations, messages, and read state.

Reason: REST-backed DM workflows are required before realtime delivery or encryption complexity.

## No E2EE For MVP

Decision: end-to-end encryption is excluded from MVP.

Reason: school operations need reliable server-side moderation, auditability, and MVP delivery more than encrypted DM complexity.

## Basic Gantt First

Decision: start with a read-only Gantt API/view.

Reason: tasks, milestones, and dependencies are enough for MVP planning; critical path and advanced scheduling are deferred.

## Preset Docking First

Decision: support preset layout data only for MVP.

Reason: persisted layout foundations are useful, but advanced free-form docking would distract from core workflows.

## FeatureModule Registry Instead Of Full Plugin Marketplace

Decision: use a `FeatureModule` registry for feature discovery and navigation.

Reason: it provides stable module metadata without committing to a full plugin marketplace.

## XServer VPS Or OCI Depending Availability

Decision: deploy to XServer VPS or OCI depending on availability and operational constraints.

Reason: both can support a single ASP.NET Core app with PostgreSQL; final selection can be made near deployment.

## Docker-Ready But Not Docker-First

Decision: keep the app Docker-ready while allowing local non-Docker development.

Reason: configuration, storage paths, and PostgreSQL connection strings should not block container deployment, but Docker should not slow MVP feature work.
