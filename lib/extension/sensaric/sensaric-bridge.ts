import bind from 'bind-decorator';
import http from 'http';
import url from 'url';
import utils from "../../util/utils";
import stringify from "json-stable-stringify-without-jsonify";
import * as settings from "../../util/settings";

type DefinitionPayload = {
    model: string, vendor: string, description: string, exposes: zhc.DefinitionExpose[], supports_ota:
        boolean, options: zhc.DefinitionExpose[],
};
type Scene = {id: number, name: string};
interface Data {
    bindings: {cluster: string, target: {type: string, endpoint?: number, ieee_address?: string, id?: number}}[]
    configured_reportings: {cluster: string, attribute: string | number,
        minimum_report_interval: number, maximum_report_interval: number, reportable_change: number}[],
    clusters: {input: string[], output: string[]}, scenes: Scene[]
}
interface DeviceExtended {
    interviewing: boolean;
    friendly_name: string;
    endpoints: { [p: number]: Data };
    software_build_id: string;
    interview_completed: boolean;
    ieee_address: string;
    description: string;
    model_id: string;
    type: "Coordinator" | "Router" | "EndDevice" | "Unknown" | "GreenPower";
    manufacturer: string;
    network_address: number;
    disabled: boolean;
    definition: DefinitionPayload;
    date_code: string;
    power_source: string;
    supported: boolean
}
export default class SensaricBridge {
    private mqttBaseTopic: string;
    private host: string;
    private port: number;
    private zigbee: Zigbee;
    private mqtt: MQTT;
    constructor(mqttBaseTopic: string, host: string, port: number, zigbee: Zigbee, mqtt: MQTT) {
        this.mqttBaseTopic = mqttBaseTopic;
        this.host = host;
        this.port = port;
        this.zigbee = zigbee;
        this.mqtt = mqtt;
    }

    @bind
    public async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
        const parsedUrl = url.parse(request.url, true);

        if (parsedUrl.pathname === '/api/devices' && request.method === 'GET') {
            this.endResponse(response, this.getDeviceList());
            return true;
        } else if (parsedUrl.pathname === '/api/devices' && request.method === 'PUT') {
            const body = await this.readRequestBody(request);
            const message = JSON.parse(body);
            this.mqtt.onMessage(`${this.mqttBaseTopic}/${message['deviceName']}/set`, Buffer.from(stringify(message['attributes'])));
            response.writeHead(200, {'Content-Type': 'application/json'});
            response.end(body);
            return true;
        }

        return false;
    }
    private getDeviceList(): DeviceExtended[] {
        return this.zigbee.devices().map((device) => {
            const endpoints: { [s: number]: Data } = {};
            for (const endpoint of device.zh.endpoints) {
                const data: Data = {
                    scenes: [],
                    bindings: [],
                    configured_reportings: [],
                    clusters: {
                        input: endpoint.getInputClusters().map((c) => c.name),
                        output: endpoint.getOutputClusters().map((c) => c.name),
                    },
                };

                for (const bind of endpoint.binds) {
                    const target = utils.isEndpoint(bind.target) ?
                        {type: 'endpoint', ieee_address: bind.target.getDevice().ieeeAddr, endpoint: bind.target.ID} :
                        {type: 'group', id: bind.target.groupID};
                    data.bindings.push({cluster: bind.cluster.name, target});
                }

                for (const configuredReporting of endpoint.configuredReportings) {
                    data.configured_reportings.push({
                        cluster: configuredReporting.cluster.name,
                        attribute: configuredReporting.attribute.name || configuredReporting.attribute.ID,
                        minimum_report_interval: configuredReporting.minimumReportInterval,
                        maximum_report_interval: configuredReporting.maximumReportInterval,
                        reportable_change: configuredReporting.reportableChange,
                    });
                }

                endpoints[endpoint.ID] = data;
            }

            return {
                ieee_address: device.ieeeAddr,
                type: device.zh.type,
                network_address: device.zh.networkAddress,
                supported: !!device.definition,
                friendly_name: device.name,
                disabled: !!device.options.disabled,
                description: device.options.description,
                definition: this.getDefinitionPayload(device),
                power_source: device.zh.powerSource,
                software_build_id: device.zh.softwareBuildID,
                date_code: device.zh.dateCode,
                model_id: device.zh.modelID,
                interviewing: device.zh.interviewing,
                interview_completed: device.zh.interviewCompleted,
                manufacturer: device.zh.manufacturerName,
                endpoints,
            };
        });
    }

    getDefinitionPayload(device: Device): DefinitionPayload {
        if (!device.definition) return null;

        return {
            model: device.definition.model,
            vendor: device.definition.vendor,
            description: device.definition.description,
            exposes: device.exposes(),
            supports_ota: !!device.definition.ota,
            options: device.definition.options,
        };
    }

    private endResponse(response: http.ServerResponse, body: unknown):void {
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end(JSON.stringify(body));
    }
    private readRequestBody(request: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            request.on('data', (chunk) => {
                body += chunk.toString();
            });
            request.on('end', () => {
                resolve(body);
            });
            request.on('error', (err) => {
                reject(err);
            });
        });
    }
}
