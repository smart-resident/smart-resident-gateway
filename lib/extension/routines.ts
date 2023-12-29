import * as settings from '../util/settings';
import bind from 'bind-decorator';
import Extension from './extension';
import * as console from "console";
import utils from "../util/utils";
import {getRoutine} from "../util/settings";

export default class Routines extends Extension {
    private legacyApi = settings.get().advanced.legacy_api;
    private lastOptimisticState: { [s: string]: KeyValue } = {};

    override async start(): Promise<void> {
        this.eventBus.onStateChange(this, this.onStateChange);
        this.eventBus.onMQTTMessage(this, this.onMQTTMessage);
        await this.syncRoutinesWithSettings();
    }

    private async syncRoutinesWithSettings(): Promise<void> {

    }

    @bind
    async onStateChange(data: eventdata.StateChange): Promise<void> {

    }

    @bind
    private async onMQTTMessage(data: eventdata.MQTTMessage): Promise<void> {
        console.log(data)

    }

    // private addRoutine(routine: RoutineOptions): RoutineOptions {
    //     let name = routine.friendly_name;
    //     let ID = routine.ID?.toString();
    //     utils.validateFriendlyName(name, true);
    //     if (getRoutine(name)) {
    //         throw new Error(`friendly_name '${name}' is already in use`);
    //     }
    //
    //     const settings = getInternalSettings();
    //     if (!settings.routines) {
    //         settings.routines = {};
    //     }
    //
    //     if (ID == null) {
    //         // look for free ID
    //         ID = '1';
    //         while (settings.routines.hasOwnProperty(ID)) {
    //             ID = (Number.parseInt(ID) + 1).toString();
    //         }
    //     } else {
    //         // ensure provided ID is not in use
    //         ID = ID.toString();
    //         if (settings.routines.hasOwnProperty(ID)) {
    //             throw new Error(`Routine ID '${ID}' is already in use`);
    //         }
    //     }
    //
    //     routine.ID = Number.parseInt(ID);
    //     settings.routines[ID] = routine;
    //     write();
    //
    //     return getRoutine(ID);
    // }
}
