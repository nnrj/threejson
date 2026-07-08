[中文](../zh/event-mechanism.md) | [English](./event-mechanism.md)

# Event Mechanism And EventScript

ThreeJSON event handling lets JSON object records declare an `events` block. At runtime, the event system binds platform events and executes declarative actions, EventScript, or optional JavaScript handlers.

## Architecture

| Component | Responsibility |
|-----------|----------------|
| `EventBindingRegistry` | Stores `(threeJsonId, eventName) -> binding`. |
| `EventListenerManager` | Lazily attaches DOM listeners and dispatches platform events. |
| `bindEventsFromScene` | Scans scene objects and registers bindings from `userData.objJson.events`. |
| `bindSceneEventRuntime` | Scene-level bind, rebind, and dispose entry. |
| `CoreActionExecutor` | Executes JSON `action` / `actions`. |
| `CoreBindingExecutor` | Executes EventScript or JavaScript bindings. |

Execution order for the same object and event is domain-only binding, JSON actions, script, then runtime handler.

## JSON `events`

```json
{
  "threeJsonId": "event-demo-box",
  "objType": "box",
  "events": {
    "click": {
      "script": "self.moveBy(-30, 0, 0)\nawait wait(400)\nself.moveBy(30, 0, 0)"
    }
  }
}
```

Prefer declarative `action` / `actions` for simple interaction, and use `script` for more complex behavior. If both are present, actions run before script.

```json
{
  "events": {
    "click": {
      "action": { "type": "object.toggleVisible", "target": "panel-1" },
      "script": "await wait(300)\nself.moveBy(1, 0, 0)"
    }
  }
}
```
