/**

 * Scene model queries and editor collision helpers (AABB).

 */



import * as THREE from 'three';

import { IMPACT_BOX_HELPER_COLOR } from '../theme/runtimeVisualDefaults.js';

import { findAabbIntersections } from '../util/spatialQuery.js';

import { log } from '../util/logger.js';

import { matchesObjTypeForSceneQuery } from "./domainDeployDescriptor.js";



/** @param {THREE.Object3D["userData"]|undefined|null} userData */

function linkedObjJson(userData) {

  if (!userData || typeof userData !== "object") {

    return null;

  }

  const j = userData.objJson;

  return j && typeof j === "object" && !Array.isArray(j) ? j : null;

}



/**

 * @param {THREE.Object3D} model

 * @param {string} type Compared against `userData.objJson.objType`

 * @returns {boolean}

 */

function checkModelType(model, type){

    const j = linkedObjJson(model?.userData);

    if(model && j && matchesObjTypeForSceneQuery(j, type)){

        return true;

    }

    return false;

}



const IMPACT_CHECK_HELPER_TYPE = "impactCheckBoxHelper";



/**

 * @param {THREE.Object3D|undefined|null} subObj

 * @returns {boolean}

 */

function isImpactCheckHelper(subObj) {

    return subObj?.type === "BoxHelper"

        && subObj.userData?.type === IMPACT_CHECK_HELPER_TYPE;

}



/**

 * @param {THREE.Scene|undefined|null} scene

 * @param {(helper: THREE.BoxHelper) => void} visit

 */

function forEachImpactCheckHelper(scene, visit) {

    if (!scene) {

        return;

    }

    scene.traverse((subObj) => {

        if (subObj?.geometry && isImpactCheckHelper(subObj)) {

            visit(/** @type {THREE.BoxHelper} */ (subObj));

        }

    });

}



/**

 * Use {@link impactCheck} to find objJson-bearing objects whose bounds intersect `model`, and add a red BoxHelper per hit.

 * Calls {@link hideImpactCheck} first to hide helpers from the previous pass.

 * @param {THREE.Object3D} model Must have `geometry`

 * @param {THREE.Scene} scene

 */

function impactHandler(model, scene){

    if(!model || !model.geometry || !scene){

        return;

    }

    hideImpactCheck(scene);

    let impactModelList = impactCheck(model, scene);

    if(impactModelList && impactModelList.length > 0){

        for(let i = 0; i < impactModelList.length; i++){

            if(impactModelList[i] && impactModelList[i].geometry){

                let subBoxHelper = new THREE.BoxHelper(impactModelList[i], IMPACT_BOX_HELPER_COLOR);

                subBoxHelper.userData = {

                    type: IMPACT_CHECK_HELPER_TYPE

                }

                scene.add(subBoxHelper);

            }

        }

    }

}



/**

 * AABB intersection test for objects with geometry and userData.objJson (does not modify scene or add helpers).

 * @param {THREE.Object3D} model

 * @param {THREE.Scene} scene

 * @returns {THREE.Object3D[]}

 */

function impactCheck(model, scene){

    if(!model || !model.geometry || !scene){

        return [];

    }

    log.debug("[impactCheck] start, target:", model);

    const impactModelList = findAabbIntersections(model, scene);

    for (let i = 0; i < impactModelList.length; i++) {

        log.debug("[impactCheck] hit:", impactModelList[i]);

    }

    log.debug("[impactCheck] end, count:", impactModelList.length);

    return impactModelList;

}



/**

 * Hide collision-check BoxHelpers in the scene (does not dispose).

 * @param {THREE.Scene} scene

 */

function hideImpactCheck(scene){

    forEachImpactCheckHelper(scene, (helper) => {

        helper.visible = false;

    });

}



/**

 * Remove collision-check BoxHelpers from the scene and dispose geometry and materials.

 * @param {THREE.Scene} scene

 */

function clearImpactCheck(scene){

    forEachImpactCheckHelper(scene, (helper) => {

        scene.remove(helper);

        if (helper.geometry) {

            helper.geometry.dispose();

        }

        if (helper.material) {

            helper.material.dispose();

        }

    });

}



export {

    checkModelType,

    impactCheck,

    impactHandler,

    clearImpactCheck

}


