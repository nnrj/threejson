/**
 * Resource library binding over host-kit's ThreeBox session store.
 *
 * App-local rather than in @threejson/react: resources have exactly one consumer (this app), so per
 * the extraction rule it stays here. It mirrors the shape of the package's useConversations — own
 * the cached list, re-read after each write, keep IndexedDB authoritative — because both wrap the
 * same subscription-less CRUD store.
 *
 * A "resource" here is a saved scene the user can reload later: kind `json`, name, and the scene
 * snapshot string. The store also models image/model/tjz kinds with blobs, but this app only
 * produces scene resources (Save current scene), so those are listed if present but not created here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllResources,
  putResource,
  deleteResource,
  createResourceId
} from "./lib/sceneAgentRepository.js";

export function useResources() {
  const [resources, setResources] = useState([]);
  const [ready, setReady] = useState(false);
  const available = typeof indexedDB !== "undefined";

  const refresh = useCallback(async () => {
    if (!available) {
      setReady(true);
      return [];
    }
    try {
      const list = await getAllResources();
      setResources(list);
      return list;
    } catch {
      return [];
    } finally {
      setReady(true);
    }
  }, [available]);

  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) {
      return;
    }
    mountedRef.current = true;
    void refresh();
  }, [refresh]);

  /** Persist a scene snapshot as a named resource. Returns the stored record, or null if unavailable. */
  const saveScene = useCallback(
    async (sceneJson, name) => {
      if (!available || !sceneJson) {
        return null;
      }
      const record = {
        id: createResourceId(),
        kind: "json",
        name: name || "Untitled scene",
        sceneJson,
        createdAt: Date.now()
      };
      await putResource(record);
      await refresh();
      return record;
    },
    [available, refresh]
  );

  const remove = useCallback(
    async (id) => {
      if (!available) {
        return;
      }
      await deleteResource(id);
      await refresh();
    },
    [available, refresh]
  );

  return { resources, ready, persistent: available, refresh, saveScene, remove };
}
