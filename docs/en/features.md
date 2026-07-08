[中文](../zh/features.md) | [English](./features.md)

# ThreeJSON Features

ThreeJSON is a JSON-driven Three.js scene runtime. It lets a scene be described as structured data, loaded by a runtime, edited by tools, and reused by demos, players, editors, or AI workflows.

## JSON Driven

Scenes are declared in JSON instead of being hard-coded in imperative JavaScript. A scene can describe renderer, camera, controls, lights, objects, materials, animations, events, and domain objects.

## AI Friendly

Because the scene is structured data, LLMs can generate, inspect, patch, and explain scene content. ThreeJSON supports full-scene JSON, incremental JSON patch workflows, and command-oriented runtime mutation.

## Object Management

Every meaningful object can have a stable `threeJsonId`, `name`, `label`, and typed object record. This makes selection, highlighting, editing, export, and runtime mutation practical.

## Domains

Domain handlers let higher-level concepts be represented in JSON while still deploying into Three.js objects. Domains are useful for business components, topology objects, panels, charts, and reusable scene patterns.

## Extensions

Extensions add focused capabilities without bloating the core runtime. Examples include first-person navigation, physics, advanced rendering, CSS3D panels, and other optional behaviors.

## Runtime Changes

ThreeJSON supports runtime object mutation and declarative commands, so tools can update a scene without rebuilding everything. This is the basis for editor operations, AI incremental updates, and interactive demos.

## Events And Scripts

The event mechanism connects JSON objects to declarative actions and optional scripts. It allows click, hover, lifecycle, and custom behaviors while keeping the scene definition portable.
