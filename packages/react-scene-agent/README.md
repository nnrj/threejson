# @threejson/react-scene-agent

React bindings and UI primitives for `@threejson/scene-agent-kit`. Components are unbranded and
receive provider, storage, navigation, notification and product chrome through props/adapters.
Importing the package does not register domains or contact a network service.

```jsx
import { SceneAgentSceneCard } from "@threejson/react-scene-agent/scene-card";
import "@threejson/react-scene-agent/styles.css";
```

The stylesheet supplies low-specificity structural defaults. Product styles can override them
without copying the component implementation. Scene cards accept host callbacks for navigation,
mesh-export dialogs, toasts, asset gateways and archive resolution; no product URL is built in.
