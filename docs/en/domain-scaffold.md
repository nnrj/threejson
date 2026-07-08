[中文](../zh/domain-scaffold.md) | [English](./domain-scaffold.md)

# Domain Scaffold Template

This document defines a common scaffold for new business domains. A domain should generally follow three layers: `create*Json`, `create*`, and `deploy*`. Registration contracts are validated by `validateDomainDescriptor` in `core/handler/businessDomainRegistry.js`.

The document is written for any host application: demos, business pages, editors, or custom tools.

## Documentation Layers

- Library layer: this document, `docs/domains.md`, and core domain contracts.
- Application layer: host-specific UI, history stacks, and optional convenience calls such as `addToScene`.

## Template Levels

### Simple Domain

Use one file when the domain only needs lightweight `domainModelList` dispatch:

- `domains/<id>/index.js`

### Composite Domain

Use three files when object creation, default JSON, and assembly need a stable flow:

- `domains/<id>/index.js`
- `domains/<id>/<id>Factory.js`
- `domains/<id>/<id>.js`

### Composite Domain With Handler

Use four files when the domain also includes statistics, animation, or operational commands:

- `domains/<id>/index.js`
- `domains/<id>/<id>Factory.js`
- `domains/<id>/<id>Handler.js`
- `domains/<id>/<id>.js`

### Nested Subdomains

Use qualified ids for nested domains when one business concept owns smaller reusable concepts. Keep registration explicit and document which JSON records each domain accepts.
