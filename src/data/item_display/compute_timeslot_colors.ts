import { computeDomain, computeEntity } from 'custom-card-helpers';
import { isDefined, omit, unique } from '../../helpers';
import { Action, EVariableType, ServiceCall, Timeslot } from '../../types';
import { compareActions } from '../actions/compare_actions';

const DEFAULT_COLOR_ON = [102, 166, 30];
const DEFAULT_COLOR_OFF = [255, 0, 41];
const DEFAULT_COLOR_UNKNOWN = [189, 189, 189];

type ColorMap = [number, number, number][];

const COLORMAP_HEAT: ColorMap = [
  [123, 103, 85],
  [255, 129, 0],
];

const COLORMAP_COOL: ColorMap = [
  [43, 154, 249],
  [50, 70, 79],
];

const COLORMAP_BRIGHTNESS: ColorMap = [
  [123, 103, 85],
  [245, 141, 16],
];

enum EColorMap {
  Heat,
  Cool,
  Brightness,
  Other,
}

const COLORS = [
  '#984ea3',
  '#00d2d5',
  '#ff7f00',
  '#af8d00',
  '#7f80cd',
  '#c42e60',
  '#a65628',
  '#f781bf',
  '#8dd3c7',
  '#bebada',
  '#fb8072',
  '#fdb462',
  '#fccde5',
  '#bc80bd',
  '#ffed6f',
  '#c4eaff',
  '#cf8c00',
  '#1b9e77',
  '#d95f02',
  '#e7298a',
  '#e6ab02',
  '#a6761d',
  '#00d067',
  '#f43600',
  '#4ba93b',
  '#5779bb',
  '#927acc',
  '#97ee3f',
  '#bf3947',
  '#9f5b00',
  '#f48758',
  '#8caed6',
  '#f2b94f',
  '#eff26e',
  '#e43872',
  '#d9b100',
  '#9d7a00',
  '#698cff',
  '#d9d9d9',
  '#00d27e',
  '#d06800',
  '#009f82',
  '#c49200',
  '#cbe8ff',
  '#fecddf',
  '#c27eb6',
  '#8cd2ce',
  '#c4b8d9',
  '#f883b0',
  '#a49100',
  '#f48800',
  '#27d0df',
  '#a04a9b',
];

enum ColorType {
  Unassigned = 1,
  OnOffType = 2,
  RangeType = 3,
  Other = 4,
}

export type SlotColorMapping = {
  action: ServiceCall;
  type: ColorType;
  color: number[];
};

const getNextColor = (colorMap: SlotColorMapping[], maxOccurences: number = 0): number[] => {
  let num = 0;

  while (num < COLORS.length - 1) {
    const hex = COLORS[num];
    const parts = hex.substring(1).match(/.{1,2}/g)!;
    const rgb = [parseInt(parts[0], 16), parseInt(parts[1], 16), parseInt(parts[2], 16)];
    const occurences = colorMap.filter(e => e.color[0] == rgb[0] && e.color[1] == rgb[1] && e.color[2] == rgb[2])
      .length;
    if (occurences <= maxOccurences) return rgb;
    num++;
  }
  return getNextColor(colorMap, maxOccurences + 1);
};

const isTurnOnAction = (action: ServiceCall) => {
  const service = computeEntity(action.service);
  switch (service) {
    case 'turn_on':
      return Object.keys(action.service_data || {}).length ? false : true;
    default:
      return false;
  }
};

const isTurnOffAction = (action: ServiceCall) => {
  const service = computeEntity(action.service);
  switch (service) {
    case 'turn_off':
      return true;
    case 'set_hvac_mode':
      const hvac_mode = (action.service_data || {}).hvac_mode;
      return hvac_mode == 'off';
    default:
      return false;
  }
};

const computeColorMap = (action: ServiceCall): EColorMap => {
  const domain = computeDomain(action.service);
  const service = computeEntity(action.service);
  if (domain == 'light' && service == 'turn_on' && (action.service_data || {}).includes('brightness')) {
    return EColorMap.Brightness;
  }
  if (domain == 'climate' && service == 'set_temperature') {
    const hvacMode = action.service_data?.hvac_mode;
    if (hvacMode == 'cool') return EColorMap.Cool;
    else if (hvacMode == 'heat') return EColorMap.Heat;
    else if (hvacMode == 'heat_cool') return EColorMap.Heat;
    else return EColorMap.Heat;
  }
  return EColorMap.Other;
};

export const computeTimeslotColors = (
  slots: Timeslot[],
  actionConfig: Action[],
  colorMapping: SlotColorMapping[] = []
): SlotColorMapping[] => {
  //calculate the various actions used in the schedule
  const usedActions = unique(
    slots
      .map(e => {
        const action = e.actions[0];
        if (!action) return null;
        return actionConfig.find(e => compareActions(e, action, true));
      })
      .filter(isDefined)
  );

  //calculate types of actions used in the schedule

  let rangeMin: number | null = null;
  let rangeMax: number | null = null;

  const slotTypes = slots.map(e => {
    const action = e.actions.length ? e.actions[0] : null;
    if (!action) return ColorType.Unassigned;
    else if (isTurnOnAction(action) || isTurnOffAction(action)) return ColorType.OnOffType;
    const actionCfg = usedActions.find(e => compareActions(e, action, true))!;

    const assignedVars = Object.keys(actionCfg.variables || {}).filter(
      field => action.service_data && field in action.service_data
    );

    if (assignedVars.length && actionCfg.variables![assignedVars[0]].type == EVariableType.Level) {
      const value = Number(action.service_data![assignedVars[0]]);
      if (rangeMin === null || value < rangeMin) rangeMin = value;
      if (rangeMax === null || value > rangeMax) rangeMax = value;
      return ColorType.RangeType;
    } else return ColorType.Other;
  });

  let usedIndices: number[] = [];
  slots.forEach((slot, i) => {
    const action: ServiceCall = slot.actions.length ? omit(slot.actions[0], 'entity_id') : { service: '' };
    const res = colorMapping.findIndex(e => compareActions(e.action, action));
    if (res != -1) {
      usedIndices.push(res);
      return;
    }

    let output: SlotColorMapping = {
      action: action,
      type: slotTypes[i],
      color: [0, 0, 0],
    };
    if (slotTypes[i] == ColorType.Unassigned) output = { ...output, color: DEFAULT_COLOR_UNKNOWN };
    else if (slotTypes[i] == ColorType.OnOffType) {
      output = { ...output, color: isTurnOnAction(action) ? DEFAULT_COLOR_ON : DEFAULT_COLOR_OFF };
    } else if (
      slotTypes[i] == ColorType.RangeType &&
      slotTypes.every(e => [ColorType.Unassigned, ColorType.RangeType].includes(e)) &&
      rangeMin !== null &&
      rangeMax !== null &&
      rangeMin < rangeMax
    ) {
      const actionCfg = usedActions.find(e => compareActions(e, action, true))!;
      const value = Number(slot.actions[0].service_data![Object.keys(actionCfg.variables!)[0]]);
      const colorMap = computeColorMap(slot.actions[0]);
      output = { ...output, color: computeLinearScaleColor(rangeMin!, rangeMax!, value, colorMap) };
    } else {
      output = { ...output, color: [] };
    }
    usedIndices.push(colorMapping.length);
    colorMapping = [...colorMapping, output];
  });

  if (usedIndices.length != colorMapping.length) {
    let unusedIndices: number[] = [];
    for (let i = 0; i < colorMapping.length; i++) {
      if (usedIndices.find(e => e == i) === undefined) unusedIndices.push(i);
    }
    unusedIndices.reverse().forEach(e => {
      colorMapping.splice(e, 1);
    });
  }

  colorMapping.forEach((e, i) => {
    if (!e.color.length) {
      colorMapping[i] = { ...e, color: getNextColor(colorMapping) };
    }
  });

  return colorMapping;
};

const computeLinearScaleColor = (min: number, max: number, value: number, colormap: EColorMap) => {
  const scale = (value - min) / (max - min);

  const getColorMap = (): ColorMap => {
    switch (colormap) {
      case EColorMap.Brightness:
        return COLORMAP_BRIGHTNESS;
      case EColorMap.Heat:
        return COLORMAP_HEAT;
      case EColorMap.Cool:
        return COLORMAP_COOL;
      default:
        return [
          [0, 0, 0],
          [0, 0, 0],
        ];
    }
  };
  const gradient = getColorMap();

  const stops = gradient.length - 2;
  const startIndex = Math.floor(scale * stops);
  const scaleMin = startIndex / (stops + 1);
  const scaleMax = (startIndex + 1) / (stops + 1);
  const relScale = (scale - scaleMin) / (scaleMax - scaleMin);

  let res = [0, 0, 0].map((_e, i) => {
    return Math.round(gradient[startIndex][i] * (1 - relScale) + gradient[startIndex + 1][i] * relScale);
  });
  return res;
};
