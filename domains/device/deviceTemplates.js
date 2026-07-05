import { assetUrl } from '../../assets/assetsBase.js';
import {
  DEVICE_BOX_NEUTRAL,
  DEVICE_BRAND_FOREGROUND,
  DEVICE_CAPACITY_HIGHLIGHT,
  DEVICE_SHELL_DARK,
  DEVICE_SHELL_SIDE,
  DEVICE_SLOT_DARK,
  DEVICE_TEMPLATE_DEFAULT_OPACITY
} from './devicePalette.js';

/**
 * Device domain JSON assembly templates for cabinetFactory / deviceBoxFactory / upsFactory clone.
 * Default cabinet business config: {@link ./cabinet/defaultCabinet.json}.
 */
const cabinetGroup = {
	name: "defaultCabinet",
	objType: 'cabinet',
	position: {
		x: 300,
		y: 300,
		z: 300
	},
	rotation: {
		rotationX: 0,
		rotationY: 0,
		rotationZ: 0
	},
	scale: {
		scaleX: 1,
		scaleY: 1,
		scaleZ: 1
	},
	boxModelList: [
		{
			name: "cabinetBottom",
			geometry: {
				width: 70,
				height: 2,
				depth: 90
			},
			material: {
				color: DEVICE_SHELL_DARK,
				type: "standard",
			},
			position: {
				x: 0,
				y: 0,
				z: 0
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			},
		},
		{
			name: "cabinetTop",
			geometry: {
				width: 70,
				height: 2,
				depth: 90
			},
			material: {
				color: DEVICE_SHELL_DARK,
				type: "standard",
			},
			position: {
				x: 0,
				y: 154,
				z: 0
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			},
		},
		{
			name: "cabinetLeft",
			geometry: {
				width: 2,
				height: 150,
				depth: 95
			},
			material: {
				color: DEVICE_SHELL_SIDE,
				type: "standard",
			},
			position: {
				x: -34,
				y: 78,
				z: 0
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			},
		},
		{
			name: "cabinetRight",
			geometry: {
				width: 2,
				height: 150,
				depth: 90
			},
			material: {
				color: DEVICE_SHELL_SIDE,
				type: "standard",
			},
			position: {
				x: 34,
				y: 78,
				z: 0
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			},
		},
		{
			name: "cabinetBack",
			geometry: {
				width: 70,
				height: 150,
				depth: 2
			},
			material: {
				color: DEVICE_SHELL_SIDE,
				type: "standard",
			},
			position: {
				x: 0,
				y: 78,
				z: -44
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			},
		},
		{
			name: "cabinetFront",
			objType: 'door',
			doorType: 'left',
			geometry: {
				width: 70,
				height: 150,
				depth: 2
			},
			material: {
				color: DEVICE_SHELL_SIDE,
				type: "standard",
			},
			position: {
				x: 0,
				y: 78,
				z: 44
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			},
		},
	]
}

/** Simplified cabinet group for tests (stat sub-scene deploy, etc.). */
const cabinetBoxGroup = {
	name: "内置简化机柜组",
	objType: 'capacityGroup',
	position: {
		x: 300,
		y: 300,
		z: 300
	},
	rotation: {
		rotationX: 0,
		rotationY: 0,
		rotationZ: 0
	},
	scale: {
		scaleX: 1,
		scaleY: 1,
		scaleZ: 1
	},
	boxModelList: [
		{
			name: "内置容量机柜",
			type:"dynamicBox",
			objType: 'capacityCabinet',
			geometry: {
				width: 70,
				height: 150,
				depth: 90
			},
			material: {
				color: DEVICE_CAPACITY_HIGHLIGHT,
				type: "standard",
			},
			position: {
				x: 0,
				y: 0,
				z: 0
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			}
		}
	]
}

const deviceGroup = {
	name: "defaultServer",
	objType: "device",
	deviceType: "server",
	position: {
		x: 300,
		y: 300,
		z: 300
	},
	rotation: {
		rotationX: 0,
		rotationY: 0,
		rotationZ: 0
	},
	scale: {
		scaleX: 1,
		scaleY: 1,
		scaleZ: 1
	},
	boxModelList: [
		{
			name: "内置服务器模型",
			geometry: {
				width: 68,
				height: 3.5,
				depth: 86
			},
			materials: [
				{
					color: '#CFD4D8',
					type: "standard",
					receiveShadow: true
				},
				{
					color: DEVICE_SLOT_DARK,
					type: "standard",
					receiveShadow: true
				},
				{
					color: '#CFD4D8',
					type: "standard",
					receiveShadow: true
				},
				{
					color: '#CFD4D8',
					type: "standard",
					receiveShadow: true
				},
				{
					type: "standard",
					textureUrl: assetUrl(""),
					receiveShadow: true
				},
				{
					color: '#CFD4D8',
					type: "standard",
					receiveShadow: true
				}
			],
			position: {
				x: 0,
				y: 0,
				z: 0
			},
			rotation: {
				rotationX: 0,
				rotationY: 0,
				rotationZ: 0
			},
			scale: {
				scaleX: 1,
				scaleY: 1,
				scaleZ: 1
			},
		}
	]
}

const brandPanel = {
	text: "品牌",
	type: "text",
	boxType: "box",
	objType: "infoPanel",
	color: DEVICE_BRAND_FOREGROUND,
	backColor: '#FFFFFF',
	transparent: true,
	opacity: DEVICE_TEMPLATE_DEFAULT_OPACITY,
	font: '16px SimHei',
	textVerticalAlign: 'top',
	visible: true,
	fix: false,
	cache: false,
	panel: {
		geometry: {
			width: 30,
			height: 20,
			depth: 1
		},
		position: {
			x: 0,
			y: 0,
			z: 500
		},
		material: {
			color: '#FFFFFF',
			transparent: true,
			opacity: DEVICE_TEMPLATE_DEFAULT_OPACITY
		},
		rotation: {
			rotationX: 0,
			rotationY: 0,
			rotationZ: 0
		},
		scale: {
			scaleX: 1,
			scaleY: 1,
			scaleZ: 1
		}
	}
}

const slotRailBox = {
	name: "cabinet-slot-rail",
	label: "U位刻度",
	geometry: {
		width: 3,
		height: 150,
		depth: 1
	},
	material: {
		color: DEVICE_BOX_NEUTRAL,
		type: "standard",
		textureUrl: assetUrl("textures/device/cabinet_solt.jpg"),
	},
	position: {
		x: 25,
		y: 75,
		z: 45
	},
	rotation: {
		rotationX: 0,
		rotationY: 0,
		rotationZ: 0
	},
	scale: {
		scaleX: 1,
		scaleY: 1,
		scaleZ: 1
	}
}

export {
	cabinetGroup,
	cabinetBoxGroup,
	deviceGroup,
	brandPanel,
	slotRailBox
}
