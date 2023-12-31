import * as settings from '../util/settings';
import bind from 'bind-decorator';
import Extension from './extension';
import * as console from "console";
import utils from "../util/utils";
import schedule, {Job} from "node-schedule";
import Device from "../model/device";
import stringify from "json-stable-stringify-without-jsonify";

const topicRegex =
    new RegExp(`^${settings.get().mqtt.base_topic}/bridge/request/routine/(add|update|remove|trigger)$`);


export default class Routines extends Extension {
    private monitoredDevices = new Map<string, string[]>;
    private scheduledJobs = new Map<string, Job[]>;

    override async start(): Promise<void> {
        this.eventBus.onStateChange(this, this.onStateChange);
        this.eventBus.onMQTTMessage(this, this.onMQTTMessage);
        // this.eventBus.onDeviceMessage(this, this.onDeviceMessage);
        await this.syncRoutinesWithSettings();
    }

    private async syncRoutinesWithSettings(): Promise<void> {

    }

    // @bind
    // async onDeviceMessage(data: eventdata.DeviceMessage): Promise<void> {
    //     // console.log("onDeviceMessage: " + JSON.stringify(data));
    // }

    @bind
    async onStateChange(data: eventdata.StateChange): Promise<void> {
        // console.log("onStateChange: " + JSON.stringify(data));
        let deviceOrGroup = data.entity;
        if (deviceOrGroup instanceof Device) {
            this.checkRoutineCondition((deviceOrGroup.zh as zh.Device).ieeeAddr);
        } else {
            console.log("Oops, what just happened")
        }
    }

    @bind
    private async onMQTTMessage(data: eventdata.MQTTMessage): Promise<void> {
        console.log("onMQTTMessage: " + JSON.stringify(data));
        this.runRoutineAction(data);
    }

    private runRoutineAction(data: eventdata.MQTTMessage) {
        const message = JSON.parse(data.message);
        if (data.topic.includes("request/routine/trigger")) {
            console.log("triggering routine: " + data.message);
            this.triggerRoutine(message);
        } else if (data.topic.includes("request/routine/add")) {
            console.log("adding routine: " + data.message);
            let routine = message as unknown as RoutineOptions;
            this.addRoutine(routine);
        } else if (data.topic.includes("request/routine/update")) {
            console.log("updating routine: " + data.message);
            let routine = message as unknown as RoutineOptions;
            this.updateRoutine(routine);
        } else if (data.topic.includes("request/routine/remove")) {
            console.log("removing routine: " + data.message);
            this.removeRoutine(message);
        } else {
            throw new Error(`Invalid topic, action does not exist in routines: '${data.topic}'`);
        }
    }

    private addRoutine(routine: RoutineOptions): RoutineOptions {
        this._addRoutine(routine);
        this.mqtt.publish(`bridge/response/routine/add`, stringify(routine));
        return routine;
    }

    private updateRoutine(routine: RoutineOptions): RoutineOptions {
        routine = this._updateRoutine(routine);
        this.mqtt.publish(`bridge/response/routine/update`, stringify(routine));
        return routine;
    }

    private removeRoutine(message: KeyValue): RoutineOptions {
        if (!message.hasOwnProperty('ID')) {
            throw new Error(`Invalid payload to routine remove, 'ID' does not exist`);
        }
        const routineId = message.ID;
        const routine = settings.removeRoutine(routineId);
        this.mqtt.publish(`bridge/response/routine/remove`, stringify(routine));
        return routine;
    }

    private triggerRoutine(message: KeyValue): RoutineOptions {
        if (typeof message === 'object' && !message.hasOwnProperty('ID')) {
            throw new Error(`Invalid payload to routine trigger, 'ID' does not exist`);
        }
        const routineId = message.ID;
        let routine = this._triggerRoutine(routineId);
        this.mqtt.publish(`bridge/response/routine/trigger`, stringify(routine));
        return routine;
    }


    private _addRoutine(routine: RoutineOptions): RoutineOptions {
        let routineId = routine.ID;
        if (settings.getRoutine(routineId)) {
            throw new Error(`Routine id '${routineId}' is already in use`);
        }

        settings.addRoutine(routine);

        let conditions = routine.conditions;
        for (let condition of conditions) {
            if (condition.type === "SCHEDULE") {
                console.log(`Setting up routine ${routine.friendly_name}`);
                let _this = this;
                // const job = schedule.scheduleJob('*/1 * * * *', function(){
                //     console.log('The answer to life, the universe, and everything!');
                //     _this._triggerRoutine(routineId);
                // });
                let jobs = [];
                for (let trigger of condition.triggers) {
                    let time = trigger.time.split(":");
                    const rule = new schedule.RecurrenceRule();
                    rule.dayOfWeek = trigger.days;
                    rule.hour = time[0];
                    rule.minute = time[1];
                    const job = schedule.scheduleJob(rule, function(){
                        console.log(`Running the routine ${routine.friendly_name}`);
                        _this._triggerRoutine(routineId);
                    });
                    jobs.push(job);
                }
                this.scheduledJobs.set(routineId, jobs);
            } else if (condition.type === "TRIGGER") {
                const triggers = condition.triggers;
                for (let trigger of triggers) {
                    if (!this.monitoredDevices.has(trigger.device)) {
                        this.monitoredDevices.set(trigger.device, []);
                    }
                    this.monitoredDevices.get(trigger.device).push(routineId);
                }
                console.log("Triggers set to: " + JSON.stringify(this.monitoredDevices));
            }
        }

        return routine;
    }

    private _updateRoutine(routine: RoutineOptions): RoutineOptions {
        settings.updateRoutine(routine);

        //todo remove and re-add schedules and ..
        let conditions = routine.conditions;
        for (let condition of conditions) {
            if (condition.type === "SCHEDULE") {
                console.log("Lets set up some cronning")
                const job = schedule.scheduleJob('*/1 * * * *', function(){
                    console.log('The answer to life, the universe, and everything!');
                });
            } else {
                console.log("shame no cronning")
            }
        }

        return routine;
    }

    private checkRoutineCondition(ieeeAddress: string): RoutineOptions[] {
        let device: DeviceOptions = settings.getDevice(ieeeAddress);
        console.log("The triggered device is : " + JSON.stringify(device));
        let routines: RoutineOptions[] = [];
        if (this.monitoredDevices.has(device.friendly_name)) {
            let routines = this.monitoredDevices.get(device.friendly_name);
            for (let routineId of routines) {
                let routine = settings.getRoutine(routineId);
                console.log("should run routine: " + routineId);
                this._triggerRoutine(routineId);
            }
        }
        return routines;
    }

    private _triggerRoutine(ID: string): RoutineOptions {
        const routine = settings.getRoutine(ID);
        if (!routine) {
            throw new Error(`Could not find routine in settings. '${ID}' does not exist`);
        }

        const actions = routine.actions;
        for (let action of actions) {
            switch (action.type) {
                case "OPERATE_DEVICE":
                    const deviceName = action.device;
                    const deviceMessage = action.attributes;

                    // const device = this.zigbee.resolveEntity(deviceName);
                    // this.publishEntityState(device, deviceMessage);

                    // this.mqtt.publish(deviceName + "/set", JSON.stringify(deviceMessage));
                    // this.mqtt.onMessage(`${this.mqttBaseTopic}/${topic}`, Buffer.from(stringify(payload)));

                    const topicToPublish = settings.get().mqtt.base_topic + "/" + deviceName + "/set";
                    this.eventBus.emitRoutinePublish({topic: topicToPublish, message: JSON.stringify(deviceMessage)})

                    console.log("operating device: " + action.device);
                    break;
                case "DELAY":
                    console.log("taking a nap: " + action.seconds);
                    break;
                default:
                    console.log("Unknown routine action");
                    break;
            }
        }

        return routine;
    }
}
