import { GCodeInterpreter } from 'gcode-interpreter';
import { Vec3 } from 'vec3'
import TimeFormat from 'hh-mm-ss'

const GCODE = [
    'G00 X100 F4000'
].join('\n');

const GCODE_FILE = 'escaleras_300-02.gcode'


// from in to mm
const in2mm = (val = 0) => val * 25.4;

// noop
const noop = () => { };

const translatePosition = (position, newPosition, relative) => {
    relative = !!relative;
    newPosition = Number(newPosition);
    if (Number.isNaN(newPosition)) {
        return position;
    }
    return relative ? (position + newPosition) : newPosition;
};

class GEstimate {

    position = {
        x: 0,
        y: 0,
        z: 0
    };

    feedrate = {
        G0: 0,
        G1: 0
    }

    lastParams = null;


    handlers = {

        'G0': (params) => {
            if (this.modalState.motion !== 'G0') {
                this.setModalState({ 'motion': 'G0' });
            }

            this.computeLinearMotion(params)
        },

        'G1': (params) => {
            if (this.modalState.motion !== 'G1') {
                this.setModalState({ 'motion': 'G1' });
            }

            this.computeLinearMotion(params)
        },

    };

    /*
            For each former line:
                1 Calculate the time of each axis movement

                    1.1 Calculate entering acceleration time (using entering speed), and then it's distance (using average speed)
                    1.2 Calculate the time of the remaining distance at F
                    1.3 Calculate exiting acceleration time (picking actual speed). Apply a ballpark junction time factor.
                    1.4 Accumulate the longest time of all the moved axis

                2 Latest command should compute latest line.
    
        */




    computeLinearMotion(params) {

        let v1 = {
            x: this.position.x,
            y: this.position.y,
            z: this.position.z
        };
        let v2 = {
            x: this.translateX(params.X),
            y: this.translateY(params.Y),
            z: this.translateZ(params.Z)
        };

        let motion = this.modalState.motion;

        let baseFeedRate = this.feedrate[motion] ?  this.feedrate[motion] : this.machine.feedRate[motion];
        let commandFeedRate = (params.F!==undefined) ? (params.F) : baseFeedRate;


        const targetPosition = { x: v2.x, y: v2.y, z: v2.z };

        /* For each former line:  Calculate the time of each axis movement */

        const calculateAxisTime = (dist, vi, vc, vf, axis) => {

            let axis_acc = this.machine.acc[axis]

            // 1.1 Entering Acceleration time
            let ent_time = Math.abs(vc, vi) / axis_acc;

            // 1.1 Entering Acceleration distance
            let ent_dist = ((vc + vi) / 2) * ent_time;

            // 1.3 Exiting Acceleration time
            let ext_time = Math.abs(vc, vi) / axis_acc;
            // 1.3 Apply Joint ballpark
            ext_time = ext_time * 1;
            // 1.3 Exiting Acceleration distance
            let ext_dist = ((vf + vc) / 2) * ext_time;

            

            // 1.2 Remaining constant speed time
            let time = 0, cst_dist = 0, cst_time = 0
            if ((ent_dist + ext_dist) > dist) {   // if acc/dec distance > total distance, apply trim factor to time.
                let trim = (ent_dist + ext_dist - dist) / dist;
                time = (ent_time + ext_time) * trim;
            } else {
                cst_dist = dist - ent_dist - ext_dist
                cst_time = (cst_dist / vc)
                time = ent_time + ext_time + cst_time
            }

            console.log({dist, vi, vc, vf, axis, axis_acc, time, ent_time, ent_dist, ext_time, ext_dist, cst_dist, cst_time})
            return time;

        }

        const calculateFormerLine = (lastParams, currentParams) => {
            console.log("---------")
            //console.log({lastParams, currentParams})
            const longestAxisTime = Math.max.apply(null, Object.keys(lastParams.v2).map((axis) => {

                if (!(lastParams.v2[axis] - lastParams.v1[axis])) return 0;
                
                return calculateAxisTime(
                    
                    Math.abs(lastParams.v2[axis] - lastParams.v1[axis]), // distance between axis movement
                    lastParams.baseFeedRate / 60, // stored feedRate or default
                    lastParams.commandFeedRate / 60,    // this movement feedRate or default
                    currentParams.commandFeedRate / 60,  // next feedRate
                    axis
                )
                
            }))

            const distance = new Vec3(lastParams.v1.x, lastParams.v1.y, lastParams.v1.z).distanceTo(new Vec3(lastParams.v2.x, lastParams.v2.y, lastParams.v2.z));

            //1.4 Accumulate the longest time of all the moved axis
            console.log({lastParams, currentParams,  longestAxisTime, distance })

            this.time += longestAxisTime;
            this.distance += distance;
            //console.log("---------")
        }

        let currentParams = { v1, v2, commandFeedRate, baseFeedRate, motion };

        if (this.lastParams)
            calculateFormerLine(this.lastParams, currentParams)

        this.lastParams = currentParams;

        /* ------ */

        // Update position
        this.setPosition(targetPosition.x, targetPosition.y, targetPosition.z);
        // Update feedrate
        this.setFeedRate(this.modalState.motion, commandFeedRate)

    }


    constructor(options) {

        const { modalState, addLine = noop, addArcCurve = noop } = { ...options };
        const nextModalState = {};
        Object.keys({ ...modalState }).forEach(key => {
            if (!this.modalState.hasOwnProperty(key)) {
                return;
            }
            nextModalState[key] = modalState[key];
        });
        this.setModalState(nextModalState);


        this.runner = new GCodeInterpreter({ handlers: this.handlers });
    }


    setModalState(modalState) {
        this.modalState = {
            ...this.modalState,
            ...modalState
        };

        return this.modalState;
    }
    isMetricUnits() { // mm
        return this.modalState.units === 'G21';
    }
    isImperialUnits() { // inch
        return this.modalState.units === 'G20';
    }
    isAbsoluteDistance() {
        return this.modalState.distance === 'G90';
    }
    isRelativeDistance() {
        return this.modalState.distance === 'G91';
    }
    isXYPlane() {
        return this.modalState.plane === 'G17';
    }
    isZXPlane() {
        return this.modalState.plane === 'G18';
    }
    isYZPlane() {
        return this.modalState.plane === 'G19';
    }
    setPosition(x, y, z) {
        this.position.x = (typeof x === 'number') ? x : this.position.x;
        this.position.y = (typeof y === 'number') ? y : this.position.y;
        this.position.z = (typeof z === 'number') ? z : this.position.z;
    }

    setFeedRate(motion, f) {
        this.feedrate[motion] = (typeof f === 'number') ? f : (this.feedrate[motion] || 0);
    }

    translateX(x, relative) {
        if (x !== undefined) {
            x = this.isImperialUnits() ? in2mm(x) : x;
        }
        if (relative === undefined) {
            relative = this.isRelativeDistance();
        }
        return translatePosition(this.position.x, x, !!relative);
    }
    translateY(y, relative) {
        if (y !== undefined) {
            y = this.isImperialUnits() ? in2mm(y) : y;
        }
        if (relative === undefined) {
            relative = this.isRelativeDistance();
        }
        return translatePosition(this.position.y, y, !!relative);
    }
    translateZ(z, relative) {
        if (z !== undefined) {
            z = this.isImperialUnits() ? in2mm(z) : z;
        }
        if (relative === undefined) {
            relative = this.isRelativeDistance();
        }
        return translatePosition(this.position.z, z, !!relative);
    }
    translateI(i) {
        return this.translateX(i, true);
    }
    translateJ(j) {
        return this.translateY(j, true);
    }
    translateK(k) {
        return this.translateZ(k, true);
    }
    translateR(r) {
        r = Number(r);
        if (Number.isNaN(r)) {
            return 0;
        }
        return this.isImperialUnits() ? in2mm(r) : r;
    }


    run(filename, machine, callback) {
        this.lastParams = null;
        this.machine = machine
        this.distance = 0;
        this.time = 0;
        this.runner.loadFromFile(filename, (err, results) => {
            if (err) {
                console.error(err);
                return;
            }
        }).on('end', (results) => {
            this.computeLinearMotion({x: this.position.x, y: this.position.y, z: this.position.z, F:0})
            callback({ distance: this.distance, time: TimeFormat.fromS(this.time) })
        });
    }
}

const guess = new GEstimate();
const machine = { acc: { x: 2500, y: 2500, z: 100 }, feedRate: { G0: 4000, G1: 1000 } }

//GCODE_FILE
guess.run(GCODE_FILE, machine, console.log)