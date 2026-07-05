/**
 * Three.js LoadingManager and page progress UI.
 * Updates a progress bar element during asset loads and optionally invokes callbacks with progress data.
 */
import * as THREE from 'three';

// Loading progress listener (not registered with resourceReclaimer to avoid a module dependency cycle)
const loadingManager = new THREE.LoadingManager();
let elementId = "progressBar";
let progressMessage = "Loading...";
let completeFlag = true;
let progressOpenFlag = true;
let completeRate = 0;
let completePercentage = 0;
let progressElement = null;
let updateCallback = null;
let completeCallback = null;

loadingManager.onStart = function ( url, itemsLoaded, itemsTotal ) {
	completeFlag = false;
	completeRate = getCompleteRate(itemsLoaded, itemsTotal, 0.05);
	update();
	progressMessage = formatProgressMessage("start", url, itemsLoaded, itemsTotal);
	showProgressMessage(elementId, progressMessage);
	update();
	if(progressOpenFlag){
		start()
	}
};
loadingManager.onLoad = function () {
	completeRate = 1.00;
	completePercentage = 100;
	progressMessage = formatProgressMessage("load");
	showProgressMessage(elementId, progressMessage);
	completeFlag = true;
	update();
	complete();
};
loadingManager.onProgress = function ( url, itemsLoaded, itemsTotal) {
	completeFlag = false;
	completeRate = getCompleteRate(itemsLoaded, itemsTotal, completeRate);
	update();
	progressMessage = formatProgressMessage("progress", url, itemsLoaded, itemsTotal);
	showProgressMessage(elementId, progressMessage);
};
loadingManager.onError = function (url) {
	completeFlag = false;
	progressMessage = formatProgressMessage("error", url);
	update();
	showProgressMessage(elementId, progressMessage);
};

/**
 * Enable or disable progress bar UI and callbacks (LoadingManager still runs when disabled; page text is not updated).
 * @param {boolean} flag true to enable, false to disable
 */
function openOrCloseProgressManager(flag){
	progressOpenFlag = flag;
}

/**
 * Bind the progress bar DOM element and optional callbacks.
 * @param {string|HTMLElement|null} elementOrId Element id string or a DOM node
 * @param {object} [options={}]
 * @param {(detail:{message:string,percentage:string|number,complete:boolean,rate:number})=>void} [options.onUpdate] Called on each progress update
 * @param {(detail:{message:string,percentage:string|number,complete:true,rate:number})=>void} [options.onComplete] Called when all assets finish loading
 * @returns {HTMLElement|null} Bound element
 */
function bindProgressElement(elementOrId, options = {}){
	if(typeof elementOrId === "string"){
		elementId = elementOrId;
		progressElement = document.getElementById(elementOrId);
	}
	else{
		progressElement = elementOrId || null;
		elementId = progressElement && progressElement.id ? progressElement.id : elementId;
	}
	updateCallback = typeof options.onUpdate === "function" ? options.onUpdate : null;
	completeCallback = typeof options.onComplete === "function" ? options.onComplete : null;
	return progressElement;
}

/**
 * Write progress text to the bound element and fire onUpdate.
 * @param {string} elementId Fallback: look up by id when progressElement is not cached
 * @param {string} message Display text
 */
function showProgressMessage(elementId, message){
	if(!message || !progressOpenFlag){
		return;
	}
	let element = progressElement;
	if(!element && elementId && typeof document !== "undefined"){
		element = document.getElementById(elementId);
	}
	if(element){
		element.textContent = message;
	}
	if(updateCallback){
		updateCallback({
			message,
			percentage: completePercentage,
			complete: completeFlag,
			rate: completeRate
		});
	}
}

/** Reserved extension point for LoadingManager onStart (currently a no-op). */
function start(){}

/**
 * Refresh internal percentage string completePercentage from completeRate.
 */
function update(){
	let temp = completeRate * 100;
	completePercentage = temp.toFixed(2);
}

/**
 * Invoke onComplete when all assets have loaded (if bound).
 */
function complete(){
	if(completeCallback){
		completeCallback({
			message: progressMessage,
			percentage: completePercentage,
			complete: true,
			rate: completeRate
		});
	}
}

/** Reserved delayed-complete hook (currently a no-op). */
function completeDelay(){}

/**
 * Whether all resources have finished loading.
 * @returns {boolean}
 */
function checkComplete(){
	return completeFlag;
}

/**
 * Compute load progress in 0..1; returns defaultRate when itemsTotal is 0.
 * @param {number} itemsLoaded Completed item count
 * @param {number} itemsTotal Total item count
 * @param {number} [defaultRate] Fallback when progress cannot be computed
 * @returns {number}
 */
function getCompleteRate(itemsLoaded, itemsTotal, defaultRate){
	if(itemsTotal > 0){
		return Math.min(itemsLoaded / itemsTotal, 1);
	}
	return defaultRate || 0;
}

/**
 * Build a human-readable progress message for the current state.
 * @param {'start'|'progress'|'load'|'error'} status
 * @param {string} [url] Current asset URL
 * @param {number} [itemsLoaded]
 * @param {number} [itemsTotal]
 * @returns {string}
 */
function formatProgressMessage(status, url, itemsLoaded, itemsTotal){
	const percentage = Number(completePercentage).toFixed(2);
	const fileName = getUrlName(url);
	if(status === "load"){
		return "Load complete!";
	}
	if(status === "error"){
		return fileName ? "Load error: " + fileName : "Load error!";
	}
	if(status === "start"){
		return fileName ? "Loading: " + fileName : "Loading assets...";
	}
	const totalText = itemsTotal > 0 ? " (" + itemsLoaded + "/" + itemsTotal + ")" : "";
	return "Loading, please wait... " + percentage + "% " + totalText + (fileName ? ", current: " + fileName : "");
}

/**
 * Extract the file name from a URL (without query or hash).
 * @param {string} [url]
 * @returns {string}
 */
function getUrlName(url){
	if(!url){
		return "";
	}
	const cleanUrl = String(url).split("?")[0].split("#")[0];
	const parts = cleanUrl.split("/");
	return decodeURIComponent(parts[parts.length - 1] || cleanUrl);
}

export {
	loadingManager,
	bindProgressElement,
	showProgressMessage,
	openOrCloseProgressManager,
	complete,
	checkComplete
}
