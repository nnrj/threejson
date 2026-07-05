import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { normalizeScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";
import {
  deployByObjTypeExtension,
  registerObjTypeDeployer,
  _clearSceneExtensionsForTests
} from "../core/handler/sceneExtensionRegistry.js";
import { deployCss3dPanel } from "../core/builder/css3d/css3dPanelBuilder.js";
import { normalizePointerPolicy } from "../core/builder/css3d/pointerPolicy.js";
import { payloadHasCss3dPanels } from "../core/builder/css3d/sceneDetection.js";

describe("css3d core", () => {
  it("detects css3dPanel in objectList and friendly list", () => {
    assert.equal(
      payloadHasCss3dPanels({
        objectList: [{ objType: "css3dPanel", content: { type: "html", html: "<p>x</p>" } }]
      }),
      true
    );
    assert.equal(
      payloadHasCss3dPanels({
        worldInfo: {
          css3dPanelList: [{ content: { type: "url", src: "https://example.com/" } }]
        }
      }),
      false
    );
    assert.equal(
      payloadHasCss3dPanels({
        worldInfo: {
          css3dPanelList: [{ objType: "css3dPanel", content: { type: "url", src: "https://example.com/" } }]
        }
      }),
      true
    );
  });

  it("normalizes friendly css3dPanelList into objectList", () => {
    const normalized = normalizeScenePayload({
      worldInfo: {
        css3dPanelList: [
          {
            name: "panel-a",
            width: 280,
            height: 160,
            content: { type: "html", html: "<b>Hi</b>" }
          }
        ]
      },
      sceneConfig: {
        camera: { position: { x: 0, y: 0, z: 5 } },
        controls: { target: { x: 0, y: 0, z: 0 } }
      }
    });

    const objectList = normalized.objectList || [];
    const panel = objectList.find((item) => String(item?.objType).toLowerCase() === "css3dpanel");
    assert.ok(panel);
    assert.equal(panel.name, "panel-a");
    assert.equal(panel.content.type, "html");
    assert.ok(Array.isArray(normalized.worldInfo?.css3dPanelList));
    assert.equal(normalized.worldInfo.css3dPanelList.length, 1);
  });

  it("normalizes pointerPolicy", () => {
    assert.equal(normalizePointerPolicy("panel"), "panel");
    assert.equal(normalizePointerPolicy("orbit"), "orbit");
    assert.equal(normalizePointerPolicy("auto"), "auto");
    assert.equal(normalizePointerPolicy("unknown"), "panel");
  });

  it(
    "deployCss3dPanel adds CSS3DObject to scene",
    { skip: typeof globalThis.document === "undefined" },
    () => {
      const scene = new THREE.Scene();
      deployCss3dPanel(
        { objType: "css3dPanel", content: { type: "html", html: "<p>x</p>" } },
        scene
      );
      let count = 0;
      scene.traverse((node) => {
        if (node?.isCSS3DObject === true) {
          count += 1;
        }
      });
      assert.equal(count, 1);
    }
  );

  it("deployByObjTypeExtension still dispatches user-registered css3dPanel deployer", () => {
    _clearSceneExtensionsForTests();
    let called = false;
    registerObjTypeDeployer("css3dPanel", () => {
      called = true;
    });
    const handled = deployByObjTypeExtension({ objType: "css3dPanel", name: "t" }, {});
    assert.equal(handled, true);
    assert.equal(called, true);
    _clearSceneExtensionsForTests();
  });
});
