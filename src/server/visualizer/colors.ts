import { beatI, sectionI } from "src/models/spotifyApiInterfaces";
import { VisualizerInfo, VisualizerState } from "src/models/visualizerInfo/visualizerInfo";
import { broadcastData, sendData } from "./server";
import State from "src/models/state";
import { analogous, makeTimeTransitionOffset } from "src/models/palette/colors";

interface colorShiftParams { 
    loudness: number,
    tempo: number
}

interface beatParamsInfo {
    activeBeatConf: number,
    activeBeatDur: number,
    colorShiftParams: colorShiftParams
}

export function fireBeat(state: State) {
    // console.log("       " + state.trackInfo.initialTrackProgress/1000 + " " + new Date(state.trackInfo.initialTimestamp));
    // console.log("BEAT - " + state.trackInfo.activeBeat?.confidence + " " + Math.floor(state.trackInfo.trackProgress / 1000));
    if (!state.trackInfo.activeBeat) {
        return;
    }
    const beatInfo = getBeatParamsInfo(state);

    if (!state.isSynced) {
        sendBeat(state, beatInfo);
    } else {
        broadcastBeat(state, beatInfo);
    }
}

function sendBeat(state: State, beatInfo: beatParamsInfo) {
    let shiftWeights : colorShiftParams;

    state.visualizers.forEach((visualizer) => {
        if (visualizer.colorInfo.state === VisualizerState.on) {
            if (
                beatInfo.activeBeatConf >= visualizer.colorInfo.minBeatConf &&
                beatInfo.activeBeatConf <= visualizer.colorInfo.maxBeatConf
                )
                {
                    const vizDelay = -state.globalDelay - visualizer.delay;
                    shiftWeights = {
                        loudness: visualizer.colorInfo.loudnessSensibility,
                        tempo: visualizer.colorInfo.tempoSensibility
                    }
                    const transitionColors = processNextColor( 
                        visualizer.colorInfo,
                        beatInfo.activeBeatDur + vizDelay,
                        state.trackInfo.activeSection,
                        beatInfo.colorShiftParams, 
                        shiftWeights
                        );
                    sendData(visualizer, transitionColors, visualizer.colorInfo.palette.hexColors, vizDelay);
                    visualizer.colorInfo.lastBeatTimestamp = Date.now();
                }
            }
    });
}

function broadcastBeat(state: State, beatInfo: beatParamsInfo) {
    const sharedData = state.syncSharedData;

    if (beatInfo.activeBeatConf < sharedData.minBeatConf || beatInfo.activeBeatConf > sharedData.maxBeatConf) {
        return;
    }

    const shiftWeights : colorShiftParams = {
        loudness: sharedData.loudnessSensibility,
        tempo: sharedData.tempoSensibility
    };

    const transitionColors = processNextColor( 
        sharedData,
        beatInfo.activeBeatDur,
        state.trackInfo.activeSection,
        beatInfo.colorShiftParams, 
        shiftWeights
    );
    broadcastData(sharedData, transitionColors, state.visualizerServerSocket);
    sharedData.lastBeatTimestamp = Date.now();
}

function getBeatParamsInfo(state: State): beatParamsInfo {
    const activeBeat: beatI = state.trackInfo.activeBeat;
    const activeBeatConf = activeBeat.confidence;
    const activeBeatDur = activeBeat.duration;
    const colorShiftParams: colorShiftParams = {
        loudness: state.trackInfo.meanLoudness,
        tempo: state.trackInfo.meanTempo
    }

    return {
        activeBeatConf,
        activeBeatDur,
        colorShiftParams
    }
}

function processNextColor(visualizer: VisualizerInfo, duration: number, section: sectionI, 
    refShiftParams : colorShiftParams, shiftWeights: colorShiftParams, baseShiftAlpha: number = 30, timeRatio : number = null): string[] {

    const index =
        Math.floor(
            (Date.now() - visualizer.lastBeatTimestamp) /
                visualizer.colorTickRate
        ) % visualizer.palette.hexColors.length;
    console.log(index);
    // Color transition function taking loudness info
    let sectionParams: colorShiftParams|null = null;
    if (section) {
        sectionParams = {
            loudness: section.loudness,
            tempo: section.tempo
        };
    }

    const color: string = calculateColorShift(visualizer.palette.hexColors[index], baseShiftAlpha, sectionParams, refShiftParams, shiftWeights);
    const trans: string[] = makeTimeTransitionOffset(
        visualizer.palette.hexColors,
        color,
        index,
        duration,
        visualizer.colorTickRate,
        timeRatio
    );

    return trans;
}

function calculateColorShift(startingHexColor: string, initialShift: number, 
    sectionParams: colorShiftParams|null, refParams : colorShiftParams, shiftWeights : colorShiftParams): string {
    // Fix negative angles, maybe do it logarithmically
    // Try to find a better way to detect chorus
    let shift = initialShift;
    if (!sectionParams) {
        return analogous(startingHexColor, shift).left;
    }
    const loudnessMod = (refParams.loudness / sectionParams.loudness - 1) * shiftWeights.loudness;
    const tempoMod = (refParams.tempo / sectionParams.tempo - 1) * shiftWeights.tempo;

    shift = shift + (shift * loudnessMod) + (shift * tempoMod);
    console.log(`Shift of ${shift} | 
        ${shiftWeights.loudness} ${shiftWeights.tempo} | 
        ${loudnessMod} ${tempoMod} | 
        ${sectionParams.loudness} ${sectionParams.tempo} | 
        ${refParams.loudness} ${refParams.tempo}`);
    if (shift < 0) {
        return startingHexColor;
    }
    const color = analogous(startingHexColor, shift);
    // random left or right
    return color.left;
    // if (Math.random() < (0.5 * (1 + loudnessMod))) {
        // return color.left;
    // } else {
        // return color.right;
    // }
}