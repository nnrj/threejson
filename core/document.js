export { SCENE_DOCUMENT_VERSION, createSceneDocument, isSceneDocument, indexSceneDocument, applyDocumentOperations, readDocumentPointer, cloneDocumentData } from "./document/sceneDocument.js";
export { compileAuthoring, formatAuthoring, inspectAuthoringMigration } from "./document/authoringAdapters.js";
export { evaluateSceneDesign, orderSceneDependencies, planSceneDesignRelations, restoreSceneDesignAuthoring } from "./document/sceneDesign.js";
export { diffSceneDocuments } from "./document/sceneDocumentDiff.js";
