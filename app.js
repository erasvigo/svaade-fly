/*
app.js
Copyright (c) 2026 Erasmo Alonso Iglesias.
All rights reserved.
*/

/**
 * FLIGHT PLANNER APP
 * Refactored version: Cleaned up syntax errors, removed dead code, 
 * expanded inline statements to full blocks, and translated comments to English.
 */

// ============================================================================
//   1. STATE & CONFIGURATION
// ============================================================================
class StateManager {
    constructor() {
        this.waypoints = [];
        this.unit = 'USG';
        this.fuelType = 'AVGAS100LL';
        // Base values storage without rounding to avoid error accumulation
        this.baseFuelValues = {};
    }

    clearWaypoints() {
        this.waypoints = [];
    }

    addWaypoint(waypoint) {
        this.waypoints.push(waypoint);
    }

    removeWaypointByIndex(index) {
        this.waypoints.splice(index, 1);
    }

    // Method to update a base value
    updateBaseFuelValue(id, value) {
        this.baseFuelValues[id] = parseFloat(value) || 0;
    }

    // Method to get a base value (returns undefined if never saved)
    getBaseFuelValue(id) {
        return this.baseFuelValues[id];
    }
}

class FuelConverter {
    static L_PER_USG = 3.78541;
    static KG_PER_LB = 0.45359237;
    
    // Densities in KG/L
    static DENSITY = {
        'JET-A1': 0.804,
        'JET-A': 0.804,
        'JET-B': 0.770,
        'AVGAS100LL': 0.7185,
        'MOGAS': 0.750
    };

    static getMultiplier(fromUnit, fromType, toUnit, toType) {
        if (fromUnit === toUnit) {
            return 1;
        }

        // 1. Normalize input to Liters
        let liters = 1;

        if (fromUnit === 'USG') {
            liters = FuelConverter.L_PER_USG;
        } else if (fromUnit === 'L') {
            liters = 1;
        } else if (fromUnit === 'KG') {
            liters = 1 / FuelConverter.DENSITY[fromType];
        } else if (fromUnit === 'lb') {
            // Pounds -> KG -> Liters
            liters = FuelConverter.KG_PER_LB / FuelConverter.DENSITY[fromType];
        }

        // 2. Convert from Liters to output unit
        if (toUnit === 'USG') {
            return liters / FuelConverter.L_PER_USG;
        } else if (toUnit === 'L') {
            return liters;
        } else if (toUnit === 'KG') {
            return liters * FuelConverter.DENSITY[toType];
        } else if (toUnit === 'lb') {
            // Liters -> KG -> Pounds
            return (liters * FuelConverter.DENSITY[toType]) / FuelConverter.KG_PER_LB;
        } else {
            return liters;
        }
    }
}

// ============================================================================
//   2. GEOMAG SERVICE
// ============================================================================
class GeomagService {
    constructor() {
        this.cof = null;
        this.geomagInstance = null;
        this.geoMagFunction = null;
        this.isReady = false;
        this._initPromise = null; // Initialization promise
    }

    // Now async and returns a promise
    async initialize() {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = (async () => {
            try {
                const response = await fetch('libs/noaa/WMM2025.COF');
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                this.cof = await response.text();

                if (typeof Geomag !== 'undefined' && this.cof) {
                    this.geomagInstance = new Geomag(this.cof);
                    this.geoMagFunction = this.geomagInstance.mag;
                    this.isReady = true;
                }
            } catch (error) {
                console.error('Error loading WMM2025.COF:', error);
                // Keep isReady = false so getVariation safely returns 0
            }
        })();

        return this._initPromise;
    }

    getVariation(lat, lng, alt) {
        if (!this.isReady) {
            console.warn('Geomag is not ready yet, returning variation 0.');
            return 0;
        }
        const date = this.getDateForGeoMag();
        return this.geoMagFunction(lat, lng, alt, date).dec;
    }

    getDateForGeoMag() {
        const dateElement = document.getElementById('flight-date');
        if (dateElement && dateElement.value) {
            return new Date(dateElement.value);
        }
        return new Date();
    }
}

// ============================================================================
//   3. HELPERS & UTILITIES
// ============================================================================
class DOMUtils {
    static escapeHtml(s) {
        const str = String(s || '');
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return str.replace(/[&<>"']/g, function(m) {
            return map[m];
        });
    }

    static setTime(elementId, hours) {
        const element = document.getElementById(elementId);
        if (!element) {
            return;
        }

        if (hours !== undefined && hours !== null) {
            element.innerText = FormatHelper.toHHMM(hours);
        } else {
            element.innerText = '........';
        }
    }
}

class FormatHelper {
    static formatNumber(value, decimals = 1) {
        if (isNaN(value) || value === null) {
            value = 0;
        }
        // Add useGrouping: false to avoid thousands separator
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: false
        }).format(value);
    }

    static toHHMM(hours) {
        const totalMinutes = Math.round((hours || 0) * 60);
        const hh = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
        const mm = (totalMinutes % 60).toString().padStart(2, '0');
        return `${hh}:${mm}`;
    }
}

// ============================================================================
//   4. FLIGHT CALCULATOR
// ============================================================================
class FlightCalculator {
    static calculateTAS(cas, altPressure, isaDev) {
        // ISA Temp (Celsius) = 15 - (1.98 * (alt_ft / 1000)) + ISA_deviation
        const oat = 15 - (1.98 * (altPressure / 1000)) + isaDev;
        const T0 = 288.15; // Kelvin
        const P0 = 1013.25; // hPa
        const L = 0.0065;   // Gradient
        const R = 287.05;   
        const g = 9.80665;  

        const altMeters = altPressure * 0.3048;
        const P = P0 * Math.pow(1 - (L * altMeters) / T0, g / (R * L));
        const T = (oat + 273.15);
        const sigma = (P / P0) * (T0 / T);

        return cas / Math.sqrt(sigma);
    }

    static computeFuelSummary(ramp, taxi, trip, cont, altern, reser, tripTimeHours, contTimeHours, alternTimeHours, reserTimeHours, ff, taxiFF) {
        const taxiFuel = taxi || 0;
        const tripFuel = trip || 0;
        const contFuel = cont || 0;
        const alternFuel = altern || 0;
        const reserveFuel = reser || 0;

        let safeFF = 1;
        if (ff > 0) {
            safeFF = ff;
        }

        let safeTaxiFF = safeFF;
        if (taxiFF > 0) {
            safeTaxiFF = taxiFF;
        }

        const miniTakeoffFuel = tripFuel + contFuel + alternFuel + reserveFuel;
        
        const extraFuelRaw = ramp - taxiFuel - miniTakeoffFuel;
        let extraFuel = 0;
        if (extraFuelRaw > 0) {
            extraFuel = extraFuelRaw;
        }
        
        const blockFuel = miniTakeoffFuel + extraFuel + taxiFuel;
        
        const takeoffFuelRaw = ramp - taxiFuel;
        let takeoffFuel = 0;
        if (takeoffFuelRaw > 0) {
            takeoffFuel = takeoffFuelRaw;
        }
        
        const fuelAtDestination = takeoffFuel - tripFuel;

        const noFuelThreshold = reserveFuel;
        const lowFuelThreshold = alternFuel + reserveFuel;
        let status = 'SAFE';

        if (fuelAtDestination <= noFuelThreshold) {
            status = 'EMERGENCY';
        } else if (fuelAtDestination <= lowFuelThreshold) {
            status = 'MINIMUM';
        }

        const times = {
            ramp: ramp / safeFF,
            taxi: taxiFuel / safeTaxiFF,
            takeoff: takeoffFuel / safeFF,
            trip: tripTimeHours || 0,
            cont: contTimeHours || (contFuel / safeFF),
            altern: alternTimeHours || (alternFuel / safeFF),
            reser: reserTimeHours || (reserveFuel / safeFF),
            minRequired: miniTakeoffFuel / safeFF,
            extra: extraFuel / safeFF,
            fuelAtDestination: fuelAtDestination / safeFF
        };

        return {
            ramp: ramp,
            taxi: taxiFuel,
            takeoffFuel: takeoffFuel,
            blockFuel: blockFuel,
            totalTripFuel: tripFuel,
            cont: contFuel,
            altern: alternFuel,
            reser: reserveFuel,
            minRequiredFuel: miniTakeoffFuel,
            extraFuel: extraFuel,
            fuelAtDestination: fuelAtDestination,
            status: status,
            times: times
        };
    }

    static computeMagHeading(magTrack, tas, wDir, wSpd, magVar) {
        if (!tas || tas <= 0) {
            return magTrack;
        }

        const magWindDir = (wDir - magVar + 360) % 360;
        const windAngleRad = (magWindDir - magTrack) * (Math.PI / 180);
        let ratio = (wSpd * Math.sin(windAngleRad)) / tas;

        if (ratio > 1) {
            ratio = 1;
        }
        if (ratio < -1) {
            ratio = -1;
        }

        const wca = Math.asin(ratio) * (180 / Math.PI);
        return (magTrack + wca + 360) % 360;
    }

    static computeLeg(start, end, legSpec, params, isFirst, isLast, magVar) {
        const distKM = turf.distance(start, end, { units: 'kilometers' });
        const distNM = distKM / 1.852;

        let bearing = turf.bearing(start, end); // True Track
        if (bearing < 0) {
            bearing += 360;
        }

        const magTrack = ((bearing - magVar) % 360 + 360) % 360;

        // Explicit checks to allow '0' as valid input
        let lAlt = params.alt;
        if (legSpec.alt !== undefined && legSpec.alt !== "") {
            lAlt = parseFloat(legSpec.alt);
        }

        let lIas = params.ias;
        if (legSpec.ias !== undefined && legSpec.ias !== "") {
            lIas = parseFloat(legSpec.ias);
        } 

        let lWdir = params.wdir;
        if (legSpec.wdir !== undefined && legSpec.wdir !== "") {
            lWdir = parseFloat(legSpec.wdir);
        }

        let lWspd = params.wspd;
        if (legSpec.wspd !== undefined && legSpec.wspd !== "") {
            lWspd = parseFloat(legSpec.wspd);
        }

        let lIsa = params.isa;
        if (legSpec.isa !== undefined && legSpec.isa !== "") {
            lIsa = parseFloat(legSpec.isa);
        } 

        const tas = FlightCalculator.calculateTAS(lIas, lAlt, lIsa);

        // 1. Calculate Wind Correction Angle (WCA) in radians
        const windAngleRad = ((lWdir - bearing) % 360 + 360) % 360 * (Math.PI / 180);
        let wcaRatio = (lWspd * Math.sin(windAngleRad)) / tas;
        
        // Clamp ratio to [-1, 1] to prevent Math.asin from returning NaN in extreme winds
        wcaRatio = Math.max(-1, Math.min(1, wcaRatio)); 
        const wcaRad = Math.asin(wcaRatio);
        const wcaDeg = wcaRad * (180 / Math.PI); 

        // 2. Calculate ETAS (Effective True Airspeed)
        // When crabbing, forward speed along the track is reduced by cos(WCA)
        const etas = tas * Math.cos(wcaRad);

        // 3. Calculate Headwind/Tailwind component relative to the actual TRUE HEADING
        const trueHeading = ((bearing + wcaDeg) % 360 + 360) % 360;
        const windAngleToHeadingRad = ((lWdir - trueHeading) % 360 + 360) % 360 * (Math.PI / 180);
        const headwind = lWspd * Math.cos(windAngleToHeadingRad);

        // 4. Precise GS calculation
        // If headwind is positive, it subtracts from ETAS. If negative (tailwind), it adds.
        let gs = etas - headwind; 
        if (gs < 1) {
            gs = 1;
        }

        const magHeading = FlightCalculator.computeMagHeading(magTrack, tas, lWdir, lWspd, magVar);

        const timeHours = distNM / gs;
        const timeStr = FormatHelper.toHHMM(timeHours);

        const lFF = parseFloat(legSpec.ff);
        let effFF = params.ff;
        if (!isNaN(lFF) && lFF > 0) {
            effFF = lFF;
        }

        let legBurnRaw = timeHours * effFF;

        if (isFirst) {
            legBurnRaw += params.climb || 0;
        }
        if (isLast) {
            legBurnRaw += params.desc || 0;
        }

        return {
            distNM: distNM,
            bearing: bearing,
            magTrack: magTrack,
            magHeading: magHeading,
            timeHours: timeHours,
            timeStr: timeStr,
            tas: tas,
            gs: gs,
            legBurnRaw: legBurnRaw
        };
    }

    static computeRoute(waypoints, params) {
        if (waypoints.length === 0) {
            return { segments: [], legs: [], wpFuels: [], wpETAs: [], totals: null, fuel: null };
        }

        let currentFuel = params.ramp - params.taxi;
        let totalTripBurn = 0;
        let totalDistNM = 0;
        let totalTimeHours = 0;
        let wpFuels = [currentFuel];
        let wpETAs = [];
        let segments = [];
        let legs = [];
        let fuelExhausted = false;

        let cumulativeMinutes = params.taxiMinutes || 0;
        const depTotal = params.eobtMinutes + cumulativeMinutes;
        wpETAs[0] = FormatHelper.toHHMM(depTotal / 60) + 'Z';

        if (waypoints.length >= 2) {
            for (let i = 0; i < waypoints.length - 1; i++) {
                const m1 = waypoints[i].marker.getLngLat();
                const m2 = waypoints[i + 1].marker.getLngLat();

                const start = turf.point([m1.lng, m1.lat]);
                const end = turf.point([m2.lng, m2.lat]);
                const distKM = turf.distance(start, end, { units: 'kilometers' });
                
                let npoints = Math.floor(distKM / 40);
                if (npoints < 2) {
                    npoints = 2;
                }
                if (npoints > 10) {
                    npoints = 10;
                }

                let coords = [];
                try {
                    const arc = turf.greatCircle(start, end, { npoints: npoints });
                    if (arc && arc.geometry && arc.geometry.coordinates) {
                        coords = arc.geometry.coordinates.slice();
                    }
                } catch (error) {
                    coords = [];
                }

                if (!coords || coords.length === 0) {
                    coords = [[m1.lng, m1.lat], [m2.lng, m2.lat]];
                }

                if (segments.length > 0 && coords.length > 0) {
                    coords.shift();
                }

                segments.push(...coords);

                const legResult = FlightCalculator.computeLeg(
                    start,
                    end,
                    waypoints[i + 1].legCustoms,
                    params,
                    (i === 0),
                    (i === waypoints.length - 2),
                    waypoints[i].magVar
                );

                const legMinutes = Math.round(legResult.timeHours * 60);
                cumulativeMinutes += legMinutes;

                let etaTotal = (params.eobtMinutes + cumulativeMinutes) % 1440;
                if (etaTotal < 0) {
                    etaTotal += 1440;
                }
                wpETAs[i + 1] = FormatHelper.toHHMM(etaTotal / 60) + 'Z';

                let legBurn = legResult.legBurnRaw;

                if (!fuelExhausted && legBurn > currentFuel) {
                    const remainingFuel = Math.max(0, currentFuel);
                    let ratio = 0;
                    if (remainingFuel > 0) {
                        ratio = remainingFuel / legBurn;
                    }

                    totalDistNM += (legResult.distNM * ratio);
                    totalTimeHours += (legResult.timeHours * ratio);
                    legBurn = remainingFuel;
                    totalTripBurn += legBurn;
                    currentFuel -= legBurn;
                    fuelExhausted = true;
                } else if (!fuelExhausted) {
                    totalDistNM += legResult.distNM;
                    totalTimeHours += legResult.timeHours;
                    totalTripBurn += legBurn;
                    currentFuel -= legBurn;
                }

                legs.push({
                    distNM: legResult.distNM,
                    bearing: legResult.bearing,
                    magTrack: legResult.magTrack,
                    magHeading: legResult.magHeading,
                    timeHours: legResult.timeHours,
                    timeStr: legResult.timeStr,
                    tas: legResult.tas,
                    gs: legResult.gs,
                    legBurnRaw: legResult.legBurnRaw,
                    idx: i + 1,
                    burn: legBurn
                });

                if (fuelExhausted) {
                    wpFuels[i + 1] = 0;
                } else {
                    wpFuels[i + 1] = currentFuel;
                }
            }
        }

        const timeStr = FormatHelper.toHHMM(totalTimeHours);

        const totals = {
            dist: totalDistNM,
            timeStr: timeStr,
            burn: totalTripBurn
        };

        let contTime = 0;
        if (params.ff > 0) {
            contTime = params.cont / params.ff;
        }

        let alternTime = 0;
        if (params.ff > 0) {
            alternTime = params.altern / params.ff;
        }

        let reserTime = 0;
        if (params.ffHolding > 0) {
            reserTime = params.reser / params.ffHolding;
        }

        const fuelSummary = FlightCalculator.computeFuelSummary(
            params.ramp,
            params.taxi,
            totals.burn,
            params.cont,
            params.altern,
            params.reser,
            totalTimeHours,
            contTime,
            alternTime,
            reserTime,
            params.ff
        );

        return {
            segments: segments,
            legs: legs,
            wpFuels: wpFuels,
            wpETAs: wpETAs,
            totals: totals,
            fuel: fuelSummary
        };
    }
}

// ============================================================================
//   5. UI RENDERER
// ============================================================================
class UIManager {
    static updateFuelPanel(fuel, unit) {
        // If no fuel data is available (e.g. hitting "New"), create object with zeros
        if (!fuel) {
            fuel = {
                ramp: 0, taxi: 0, takeoffFuel: 0, totalTripFuel: 0,
                cont: 0, altern: 0, reser: 0, minRequiredFuel: 0, extraFuel: 0, fuelAtDestination: 0,
                status: 'NO DATA',
                times: {
                    ramp: 0, taxi: 0, takeoff: 0, trip: 0, cont: 0, altern: 0, reser: 0,
                    minRequired: 0, extra: 0, fuelAtDestination: 0
                }
            };
        }

        const headerUnitDisplay = document.getElementById('header-unit-display');
        if (headerUnitDisplay) {
            headerUnitDisplay.innerText = unit;
        }

        const clean = function(val) {
            return FormatHelper.formatNumber(val, 1);
        };

        const fuelFields = [
            'sum-ramp', 'sum-taxi', 'sum-takeoff', 'sum-trip',
            'sum-cont', 'sum-altern', 'sum-reser', 'sum-min-req', 'sum-extra', 'sum-rem-final'
        ];
        const fuelKeys = [
            'ramp', 'taxi', 'takeoffFuel', 'totalTripFuel',
            'cont', 'altern', 'reser', 'minRequiredFuel', 'extraFuel', 'fuelAtDestination'
        ];

        for (let i = 0; i < fuelFields.length; i++) {
            const element = document.getElementById(fuelFields[i]);
            if (element) {
                element.innerText = clean(fuel[fuelKeys[i]]);
            }
        }

        const times = fuel.times || {};
        const timeFields = [
            'sum-ramp-time', 'sum-taxi-time', 'sum-takeoff-time', 'sum-trip-time',
            'sum-cont-time', 'sum-altern-time', 'sum-reser-time',
            'sum-min-req-time', 'sum-extra-time', 'sum-rem-final-time'
        ];
        const timeKeys = [
            'ramp', 'taxi', 'takeoff', 'trip', 'cont', 'altern', 'reser',
            'minRequired', 'extra', 'fuelAtDestination'
        ];

        for (let i = 0; i < timeFields.length; i++) {
            DOMUtils.setTime(timeFields[i], times[timeKeys[i]]);
        }

        const extraElement = document.getElementById('sum-extra');
        if (extraElement) {
            if (fuel.extraFuel < 0) {
                extraElement.style.color = '#dc2626';
            } else {
                extraElement.style.color = '#0f172a';
            }
        }

        const statusMsgTop = document.getElementById('fuel-status-msg');
        const statusMsgSummary = document.getElementById('fuel-status-header');

        UIManager.applyStatus(statusMsgTop, fuel.status);
        UIManager.applyStatus(statusMsgSummary, fuel.status);
    }

    static applyStatus(element, status) {
        if (!element) {
            return;
        }
        
        element.className = '';
        // Fallback for NO DATA, nulls, or any other value
        let displayText = status;
        if (!displayText) {
            displayText = 'NO DATA';
        }
        element.innerText = displayText;

        if (status === 'EMERGENCY') {
            element.classList.add('status-text-danger');
        } else if (status === 'MINIMUM') {
            element.classList.add('status-text-warn');
        } else if (status === 'SAFE') {
            element.classList.add('status-text-ok');
        } else {
            element.classList.add('status-text-gray');
        }
    }

    static updateNavLog(result, unit, mapInstance) {
        if (!result) {
            return;
        }
        const esc = function(s) {
            return DOMUtils.escapeHtml(s);
        };

        if (mapInstance) {
            const source = mapInstance.getSource('route');
            if (source) {
                source.setData({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: result.segments || []
                    }
                });
            }
        }

        if (result.wpFuels) {
            result.wpFuels.forEach(function(fuelAmount, index) {
                const element = document.getElementById(`wp-fuel-${index}`);
                if (element) {
                    let formatted = FormatHelper.formatNumber(fuelAmount, 1);
                    if (fuelAmount === null || fuelAmount === undefined) {
                        formatted = FormatHelper.formatNumber(0, 1);
                    }
                    element.innerText = `${formatted} ${unit}`;
                }
            });
        }

        if (result.wpETAs) {
            result.wpETAs.forEach(function(etaValue, index) {
                const element = document.getElementById(`wp-eta-${index}`);
                if (element) {
                    element.innerText = etaValue;
                }
            });
        } 

        if (result.legs) {
            result.legs.forEach(function(leg) {
                const element = document.getElementById(`leg-info-${leg.idx}`);
                if (!element) {
                    return;
                }

                const trackStr = Math.round(leg.magTrack).toString().padStart(3, '0');
                const headingStr = Math.round(leg.magHeading).toString().padStart(3, '0');
                const tasStr = Math.round(leg.tas);
                const gsStr = Math.round(leg.gs);
                const burnStr = FormatHelper.formatNumber(leg.burn, 1);

                // Use textContent implicitly via HTML generation, values escaped
                element.innerHTML = `
                    <div class="cell"><label>Dist</label><strong>${esc(FormatHelper.formatNumber(leg.distNM, 1))} NM</strong></div>
                    <div class="cell"><label>Mag Trk</label><strong>${esc(trackStr)}°</strong></div>
                    <div class="cell"><label>Mag Hdg</label><strong>${esc(headingStr)}°</strong></div>
                    <div class="cell"><label>ETE</label><strong>${esc(leg.timeStr)}</strong></div>
                    <div class="cell tas-cell"><label>TAS</label><strong>${esc(tasStr)} KT</strong></div>
                    <div class="cell"><label>GS</label><strong>${esc(gsStr)} KT</strong></div>
                    <div class="cell burn-cell"><label>Burn</label><strong>${esc(burnStr)} ${esc(unit)}</strong></div>`;
            });
        }

        if (result.totals) {
            const element = document.getElementById('route-total');
            if (element) {
                element.innerHTML = `
                <div class="cell"><label>Dist</label><strong>${esc(FormatHelper.formatNumber(result.totals.dist, 1))} NM</strong></div>
                <div class="cell"><label>Time</label><strong>${esc(result.totals.timeStr)}</strong></div>
                <div class="cell"><label>Burn</label><strong>${esc(FormatHelper.formatNumber(result.totals.burn, 1))} ${esc(unit)}</strong></div>`;
            }
        }
    }

    static rebuildNavLogDOM(state, unit) {
        const list = document.getElementById('list-items');
        if (!list) {
            return;
        }

        list.innerHTML = '';
        const esc = function(s) {
            return DOMUtils.escapeHtml(s);
        };

        state.waypoints.forEach(function(wp, idx) {
            if (idx > 0) {
                const legDiv = document.createElement('div');
                legDiv.className = 'leg-card-box';

                // Escape legCustoms values before injecting
                const leg = wp.legCustoms || {};
                let ffVal = '';
                if (leg.ff !== undefined) {
                    ffVal = leg.ff;
                }

                const legHtml = `
                    <div class="leg-card-header">LEG ${idx} ➔ WP ${idx + 1}</div>
                    <div id="leg-info-${idx}" class="leg-card-table"></div>
                    <div class="leg-card-inputs">
                        <div class="cell"><label>Alt</label><input type="number" lang="en" class="leg-param-input" data-idx="${idx}" data-prop="alt" value="${esc(leg.alt)}"></div>
                        <div class="cell"><label>IAS</label><input type="number" lang="en" class="leg-param-input" data-idx="${idx}" data-prop="ias" value="${esc(leg.ias)}"></div>
                        <div class="cell"><label>W/Dir</label><input type="number" lang="en" class="leg-param-input" data-idx="${idx}" data-prop="wdir" value="${esc(leg.wdir)}"></div>
                        <div class="cell"><label>W/Spd</label><input type="number" lang="en" class="leg-param-input" data-idx="${idx}" data-prop="wspd" value="${esc(leg.wspd)}"></div>
                        <div class="cell"><label>ISA</label><input type="number" lang="en" class="leg-param-input" data-idx="${idx}" data-prop="isa" value="${esc(leg.isa)}"></div>
                        <div class="cell"><label>FF (${unit}/H)</label><input type="number" lang="en" class="leg-param-input" data-idx="${idx}" data-prop="ff" value="${esc(ffVal)}"></div>
                    </div>`;

                legDiv.innerHTML = legHtml;
                list.appendChild(legDiv);
            }

            const wpDiv = document.createElement('div');
            wpDiv.className = 'wp-box';

            let label = '';
            let nameVal = '';
            if (idx === 0) {
                label = 'Departure';
                nameVal = wp.cachedName || 'DEPARTURE';
            } else if (idx === state.waypoints.length - 1) {
                label = 'Arrival';
                nameVal = wp.cachedName || 'ARRIVAL';
            } else {
                label = `WP ${idx + 1} ID`;
                nameVal = wp.cachedName;
            }

            const coords = wp.marker.getLngLat();
            const latVal = coords.lat.toFixed(5);
            const lngVal = coords.lng.toFixed(5);

            wpDiv.innerHTML = `
                <div class="wp-table">
                    <div class="cell"><label>${esc(label)}</label><input type="text" class="wp-name-input" data-idx="${idx}" value="${esc(nameVal)}"></div>
                    <div class="cell"><label>Lat</label><input type="number" lang="en" class="wp-coord-input" data-idx="${idx}" data-axis="lat" step="0.00001" value="${esc(latVal)}"></div>
                    <div class="cell"><label>Lon</label><input type="number" lang="en" class="wp-coord-input" data-idx="${idx}" data-axis="lng" step="0.00001" value="${esc(lngVal)}"></div>
                    <div class="cell eta-cell"><label>ETA</label><strong id="wp-eta-${idx}">--:--Z</strong></div>
                    <div class="cell fuel-cell"><label>Rem</label><strong id="wp-fuel-${idx}">-- ${esc(unit)}</strong></div>
                    <div class="delete-cell"><button type="button" class="btn-delete-wp" data-idx="${idx}" title="Delete">✕</button></div>
                </div>`;

            list.appendChild(wpDiv);
        });

        if (state.waypoints.length >= 2) {
            const totalDiv = document.createElement('div');
            totalDiv.className = 'leg-card-box total-box';
            totalDiv.innerHTML = `<div class="leg-card-header">TOTAL ROUTE</div><div id="route-total" class="leg-card-table"></div>`;
            list.appendChild(totalDiv);
        }

        UIManager.updateMarkerLabels(state.waypoints);
    }

    static updateMarkerLabels(waypoints) {
        waypoints.forEach(function(wp, idx) {
            const markerElement = wp.marker.getElement();
            const label = markerElement.querySelector('.wp-label');
            if (label) {
                let name = wp.cachedName;
                if (!name) {
                    name = 'WP';
                }
                label.innerText = `${idx + 1}. ${name}`;
            }
        });
    }

    static swapDepArrInputs() {
        const depInput = document.getElementById('airfield-dep');
        const arrInput = document.getElementById('airfield-arr');

        if (depInput && arrInput) {
            const temp = depInput.value;
            depInput.value = arrInput.value;
            arrInput.value = temp;
        }
    }
}

// ============================================================================
//   6. EXTERNAL SERVICES
// ============================================================================
class ExternalServices {
    static async fetchLocationName(lng, lat, wp, appController) {
        try {
            const url = `https://fly.svaade.com/libs/php/locationiq.php?lat=${lat}&lon=${lng}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const address = data.address || {};
            const nameParts = [address.village, address.town, address.city, address.municipality, address.county, 'Waypoint'];
            
            let foundName = 'Waypoint';
            for (let i = 0; i < nameParts.length; i++) {
                const p = nameParts[i];
                if (p !== undefined && p !== null) {
                    foundName = p;
                    break;
                }
            }
            wp.cachedName = foundName.toUpperCase();
        } catch (error) {
            console.warn('Error fetching location name from LocationIQ:', error);
            wp.cachedName = 'WAYPOINT';
        }

        appController.rebuildUI();
        appController.refreshApp();
    }
}

// ============================================================================
//   7. PDF EXPORTER
// ============================================================================
class PDFExporter {
    constructor(mapInstance, stateManager, appController) {
        this.map = mapInstance;
        this.state = stateManager;
        this.appController = appController;
        this.mapMarginMm = 10;
    }

    _getVal(id) {
        const el = document.getElementById(id);
        if (el && el.value.trim()) {
            return el.value.trim();
        }
        return '—';
    }

    _setupPDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const unit = this.state.unit;
        return { doc: doc, unit: unit };
    }

    _drawMapScale(ctx, canvasHeight) {
        const center = this.map.getCenter();
        const centerPx = this.map.project(center);
        const offsetPx = 100;
        const rightPx = { x: centerPx.x + offsetPx, y: centerPx.y };
        const rightLngLat = this.map.unproject(rightPx);

        const p1 = turf.point([center.lng, center.lat]);
        const p2 = turf.point([rightLngLat.lng, rightLngLat.lat]);
        const distKm = turf.distance(p1, p2, { units: 'kilometers' });
        
        const metersPerPixel = (distKm * 1000) / offsetPx;
        const magnitudesNM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
        
        let bestNM = 1;
        let minDiff = Infinity;

        for (let i = 0; i < magnitudesNM.length; i++) {
            const nm = magnitudesNM[i];
            const meters = nm * 1852;
            const px = meters / metersPerPixel;
            const diff = Math.abs(px - 120);
            if (diff < minDiff) {
                minDiff = diff;
                bestNM = nm;
            }
        }

        const bestMeters = bestNM * 1852;
        const barWidthPx = bestMeters / metersPerPixel;
        const margin = 30;
        const x = margin;
        const y = canvasHeight - margin;
        const barHeight = 3;
        const tickWidth = 1.5;
        const tickHeight = 10;
        const fontSize = 12;
 
        const barTop = y - barHeight;
        const centerY = barTop + (barHeight / 2);
        const tickTop = centerY - (tickHeight / 2);
        
        let nmText = '';
        if (bestNM >= 1) {
            nmText = `${Math.round(bestNM)} NM`;
        } else {
            nmText = `${bestNM.toFixed(1)} NM`;
        }
        const text = nmText;

        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const textWidth = ctx.measureText(text).width;
        const textY = barTop - 4;

        ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
        ctx.fillRect(x - 4, textY - fontSize - 2, barWidthPx + 8, fontSize + 16);
        ctx.fillStyle = '#1e293b';
        ctx.fillText(text, x, textY);
        
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, barTop, barWidthPx, barHeight);
        ctx.fillRect(x - (tickWidth / 2), tickTop, tickWidth, tickHeight);
        ctx.fillRect(x + barWidthPx - (tickWidth / 2), tickTop, tickWidth, tickHeight);
    }

    _drawWaypointLabels(ctx, mono = false) {
        if (!this.state.waypoints || this.state.waypoints.length === 0) {
            return;
        }
        const symbolColor = '#1e293b';
        const textColor = '#0f172a';

        ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        this.state.waypoints.forEach((wp, index) => {
            const lngLat = wp.marker.getLngLat();
            const point = this.map.project(lngLat);

            if (point) {
                let name = wp.cachedName;
                if (!name) {
                    name = 'WP';
                }
                const label = `${index + 1}. ${name}`;
                const size = 8;
                
                ctx.beginPath();
                ctx.rect(point.x - (size / 2), point.y - (size / 2), size, size);
                ctx.fillStyle = symbolColor;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                const textWidth = ctx.measureText(label).width;
                const padding = 4;
                const boxHeight = 18;
                const boxY = point.y - 32; 

                ctx.fillStyle = 'rgba(255, 255, 255, 1.00)';
                ctx.fillRect(point.x - (textWidth / 2) - padding, boxY, textWidth + (padding * 2), boxHeight);
                
                let strokeColor = '#1e293b';
                if (mono) {
                    strokeColor = '#1e293b';
                }
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 1;
                ctx.strokeRect(point.x - (textWidth / 2) - padding, boxY, textWidth + (padding * 2), boxHeight);
                ctx.fillStyle = textColor;
                ctx.fillText(label, point.x, boxY + boxHeight - 2);
            }
        });
    }

    _getStatusColor(status, isMono) {
        if (isMono) {
            return [0, 0, 0]; // Black for mono printing
        }
        if (status === 'EMERGENCY') {
            return [185, 28, 28]; // Red
        }
        if (status === 'MINIMUM') {
            return [217, 119, 6];   // Orange/Amber
        }
        return [22, 101, 52]; // Green for SAFE or default
    }

    // Converts canvas to high-contrast monochrome technical map.
    _applyTechnicalMonoFilter(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // ITU-R BT.709 Luma weights
        const LUMA_R = 0.2126;
        const LUMA_G = 0.7152;
        const LUMA_B = 0.0722;

        // Levels adjustment parameters
        const inputBlack = 50;
        const inputWhite = 235;
        const gamma = 1.15;
        const range = inputWhite - inputBlack;

        for (let i = 0; i < data.length; i += 4) {
            let gray = (data[i] * LUMA_R) + (data[i+1] * LUMA_G) + (data[i+2] * LUMA_B);
            gray = (gray - inputBlack) / range;
            if (gray < 0) {
                gray = 0;
            }
            if (gray > 1) {
                gray = 1;
            }
            gray = Math.pow(gray, 1 / gamma);

            const finalVal = Math.round(gray * 255);
            data[i] = finalVal;
            data[i+1] = finalVal;
            data[i+2] = finalVal;
        }
        ctx.putImageData(imageData, 0, 0);
    }

    _showLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'pdf-loading-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:#f8fafc;z-index:99999;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;';
        overlay.innerHTML = `
            <div style="font-weight:700;font-size:18px;margin-bottom:8px;letter-spacing:-0.01em;">Processing PDF...</div>
            <div style="font-size:14px;color:#64748b;">Adjusting view and generating high-resolution chart.</div>`;
        document.body.appendChild(overlay);
    }

    _getTargetCanvasDimensions(isLandscape) {
        const TARGET_WIDTH_PX = 1200; 
        
        // A4 = 210mm x 297mm
        // Portrait margin: Width = 190 (210-20), Height = 257 (297-40)
        // Landscape margin: Width = 277 (297-20), Height = 170 (210-40)
        let aspectRatio = 257 / 190;
        if (isLandscape) {
            aspectRatio = 170 / 277;
        }
         
        return {
            width: TARGET_WIDTH_PX,
            height: Math.round(TARGET_WIDTH_PX * aspectRatio)
        };
    }

    _prepareMapForCapture(targetWidth, targetHeight) {
        const mapContainer = document.getElementById('map');
        
        // Extract the map from the CSS flow to prevent Grid/Flex from limiting its real size.
        mapContainer.style.setProperty('position', 'fixed', 'important');
        mapContainer.style.setProperty('top', '0', 'important');
        mapContainer.style.setProperty('left', '0', 'important');
        mapContainer.style.setProperty('z-index', '9990', 'important');
        
        mapContainer.style.setProperty('width', `${targetWidth}px`, 'important');
        mapContainer.style.setProperty('height', `${targetHeight}px`, 'important');
        this.map.resize();

        if (this.state.waypoints.length >= 2) {
            const bounds = new maplibregl.LngLatBounds();
            this.state.waypoints.forEach(function(wp) {
                bounds.extend(wp.marker.getLngLat());
            });
            this.map.fitBounds(bounds, {
                padding: { top: 200, right: 80, bottom: 80, left: 80 },
                duration: 0,
                maxZoom: 12
            });
        }
    }

    _waitForMapRender(timeoutMs = 3000) {
        return new Promise((resolve) => {
            let resolved = false;
            
            const onIdle = () => {
                if (!resolved) {
                    resolved = true;
                    this.map.off('idle', onIdle);
                    setTimeout(resolve, 50);
                }
            };
             
            this.map.on('idle', onIdle);
            
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.map.off('idle', onIdle);
                    resolve();
                }
            }, timeoutMs);
        });
    }

    _restoreMapState(mapContainer, originalState) {
        // Restore all exact inline CSS styles
        mapContainer.style.cssText = originalState.cssText;

        this.map.resize();
        this.map.jumpTo({
            center: originalState.center,
            zoom: originalState.zoom
        });
    }

    async _captureMapCanvas(mono = false, isLandscape = false) {
        this._showLoadingOverlay();
        const mapContainer = document.getElementById('map');
        
        // 1. Save original map state (now we save the complete cssText)
        const originalState = {
            cssText: mapContainer.style.cssText,
            center: this.map.getCenter(),
            zoom: this.map.getZoom()
        };

        // 1.2. Hide OpenAIP filling in monochrome mode
        let originalFillVis = 'visible';
        if (mono && this.map.getLayer('openaip-airspaces-fill')) {
            originalFillVis = this.map.getLayoutProperty('openaip-airspaces-fill', 'visibility') || 'visible';
            this.map.setLayoutProperty('openaip-airspaces-fill', 'visibility', 'none');
        }

        // 1.3. Hide measurement tool
        const originalLineVis = this.map.getLayoutProperty('measure-line-layer', 'visibility') || 'visible';
        const originalPointVis = this.map.getLayoutProperty('measure-points-layer', 'visibility') || 'visible';
        this.map.setLayoutProperty('measure-line-layer', 'visibility', 'none');
        this.map.setLayoutProperty('measure-points-layer', 'visibility', 'none');

        try {
            // 2. Resize and wait for map render
            const dims = this._getTargetCanvasDimensions(isLandscape);
            const targetWidth = dims.width;
            const targetHeight = dims.height;
            
            this._prepareMapForCapture(targetWidth, targetHeight);
            await this._waitForMapRender();

            // 3. Capture canvas and draw overlays
            const originalCanvas = this.map.getCanvas();
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = originalCanvas.width;
            tempCanvas.height = originalCanvas.height;
            const ctx = tempCanvas.getContext('2d');

            // Draw base map and apply mono filter if needed
            ctx.drawImage(originalCanvas, 0, 0);
            if (mono) {
                this._applyTechnicalMonoFilter(tempCanvas);
            }

            // Calculate and apply real scale so waypoints align
            ctx.save();
            ctx.scale(originalCanvas.width / targetWidth, originalCanvas.height / targetHeight);
            
            this._drawMapScale(ctx, targetHeight);
            this._drawWaypointLabels(ctx, mono);
            ctx.restore();

            // 4. Return generated image
            return {
                dataUrl: tempCanvas.toDataURL('image/jpeg', 0.9),
                width: originalCanvas.width,
                height: originalCanvas.height
            };

        } finally {
            // 5. Restore map and remove loading overlay
            this._restoreMapState(mapContainer, originalState);

            // 5.1. Restore measurement tool
            this.map.setLayoutProperty('measure-line-layer', 'visibility', originalLineVis);
            this.map.setLayoutProperty('measure-points-layer', 'visibility', originalPointVis);

            // 5.2. Restore OpeanAIP filling
            if (mono && this.map.getLayer('openaip-airspaces-fill')) {
                this.map.setLayoutProperty('openaip-airspaces-fill', 'visibility', originalFillVis);
            }

            const overlay = document.getElementById('pdf-loading-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
    }

    _getOptimalMapOrientation() {
        const wps = this.state.waypoints;
        if (wps.length < 2) {
            return 'p';
        }

        let minLat = 90;
        let maxLat = -90;
        let minLng = 180;
        let maxLng = -180;

        wps.forEach(function(wp) {
            const lat = wp.marker.getLngLat().lat;
            const lng = wp.marker.getLngLat().lng;
            if (lat < minLat) {
                minLat = lat;
            }
            if (lat > maxLat) {
                maxLat = lat;
            }
            if (lng < minLng) {
                minLng = lng;
            }
            if (lng > maxLng) {
                maxLng = lng;
            }
        });

        const deltaLat = maxLat - minLat;
        const deltaLng = maxLng - minLng;
        const kmPerDegLat = 111.32;
        const avgLat = (minLat + maxLat) / 2;
        const kmPerDegLng = 111.32 * Math.cos(avgLat * Math.PI / 180);

        const heightKm = deltaLat * kmPerDegLat;
        const widthKm = deltaLng * kmPerDegLng;

        if ((widthKm / heightKm) > 1.20) {
            return 'l';
        }
        return 'p';
    }

    _addDispatchBox(doc, mapX, mapY, mapW, mapH, isMono = false) {
        const params = this.appController.getGlobalParams();
        const routeData = FlightCalculator.computeRoute(this.state.waypoints, params);
        const fuel = routeData.fuel || {};

        let status = fuel.status;
        if (!status) {
            status = 'SAFE';
        }
        const statusColor = this._getStatusColor(status, isMono);

        const timeVal = this._getVal('flight-time');
        let timeZ = '—';
        if (timeVal !== '—') {
            timeZ = `${timeVal}Z`;
        }
        
        const boxW = 75;
        const boxH = 45;
        const boxX = mapX + mapW - boxW;
        const boxY = mapY;

        let lineWidth = 0.2;
        let lineColor = [0, 0, 0];
        if (isMono) {
            lineWidth = 0.2;
            lineColor = [0, 0, 0];
        }

        doc.autoTable({
            startY: boxY,
            margin: { left: boxX },
            tableWidth: boxW,
            theme: 'grid',
            head: [], 
            body: [
                [
                    { content: 'FLIGHT ID', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } },
                    { content: 'DATE', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } },
                    { content: 'EOBT', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } },
                    { content: 'FUEL STATUS', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } }
                ],
                [
                    { content: this._getVal('flight-id').substring(0, 10), styles: { fontStyle: 'normal', fontSize: 7, halign: 'center' } },
                    { content: this._getVal('flight-date'), styles: { fontStyle: 'normal', fontSize: 7, halign: 'center' } },
                    { content: timeZ, styles: { fontStyle: 'normal', fontSize: 7, halign: 'center' } },
                    { content: status, styles: { fontStyle: 'bold', fontSize: 7, halign: 'center', textColor: statusColor } }
                ],
                [
                    { content: 'DEP', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } },
                    { content: 'ARR', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } },
                    { content: 'ALTN 1', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } },
                    { content: 'ALTN 2', styles: { fontStyle: 'bold', fontSize: 7, halign: 'center' } }
                ],
                [
                    { content: this._getVal('airfield-dep').toUpperCase(), styles: { fontStyle: 'normal', fontSize: 7, halign: 'center' } },
                    { content: this._getVal('airfield-arr').toUpperCase(), styles: { fontStyle: 'normal', fontSize: 7, halign: 'center' } },
                    { content: this._getVal('airfield-alt1').toUpperCase(), styles: { fontStyle: 'normal', fontSize: 7, halign: 'center' } },
                    { content: this._getVal('airfield-alt2').toUpperCase(), styles: { fontStyle: 'normal', fontSize: 7, halign: 'center' } }
                ]
            ],
            styles: {
                cellPadding: 1.0, 
                valign: 'middle', 
                lineWidth: lineWidth,
                lineColor: lineColor,
                fillColor: [255, 255, 255], 
                textColor: [0, 0, 0] 
            },
            columnStyles: { 
                0: { cellWidth: boxW / 4 }, 
                1: { cellWidth: boxW / 4 }, 
                2: { cellWidth: boxW / 4 }, 
                3: { cellWidth: boxW / 4 } 
            }
        });
    }

    _addMapToPDF(doc, capture, isMono = false) {
        if (!capture) {
            return 12;
        }
        
        // Margin
        const marginX = 10; // Left and right
        const marginY = 20; // Top and bottom
        
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        
        // Print area
        const w = pageW - (2 * marginX);
        const h = pageH - (2 * marginY);
        const x = marginX;
        const y = marginY;

        // Add image
        doc.addImage(capture.dataUrl, 'JPEG', x, y, w, h);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.2);
        doc.rect(x, y, w, h);

        this._addDispatchBox(doc, x, y, w, h, isMono);

        // Attribution
        const attrText = 'Map © OpenFreeMap | Elevation © AWS Terrain Tiles | Geocoding © LocationIQ | Aeronautical data © OpenAIP';
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');

        const textW = doc.getTextWidth(attrText);
        const boxW = textW + 4;
        const boxH = 4;
        const boxX = (pageW / 2) - (boxW / 2);
        const boxY = pageH - 25; 

        doc.setFillColor(255, 255, 255);
        doc.rect(boxX, boxY, boxW, boxH, 'F');

        let textColor = 100;
        if (isMono) {
            textColor = 100;
        }
        doc.setTextColor(textColor);
        doc.text(attrText, pageW / 2, pageH - 22, { align: 'center' });

        return 12;
    }

    _addNavlogTablesToPDF(doc, unit, startY, isMono = false) {        
        // DYNAMIC COLOR PALETTE
        let headerMain = [215, 225, 245];
        let labelGray = [245, 245, 245];
        let subHeaderGray = [225, 225, 225];
        let textDark = [0, 0, 0];
        let borderColor = [148, 163, 184];
        
        if (isMono) {
            headerMain = [205, 205, 205];
            labelGray = [245, 245, 245];
            subHeaderGray = [225, 225, 225];
            textDark = [0, 0, 0];
            borderColor = [0, 0, 0];
        }

        let cursorY = startY;
        const params = this.appController.getGlobalParams();
        const routeData = FlightCalculator.computeRoute(this.state.waypoints, params);
        const fuel = routeData.fuel || {};
        const times = fuel.times || {};
        
        const fmtFuel = function(v) {
            return FormatHelper.formatNumber(v, 1);
        };
        const fmtTime = function(v) {
            return FormatHelper.toHHMM(v);
        };

        let fuelStatus = 'NORMAL';
        if (routeData.fuel && routeData.fuel.status) {
            fuelStatus = routeData.fuel.status;
        }
        let statusTextColor = this._getStatusColor(fuelStatus, isMono);
        
        const globalStyles = {
            fontSize: 9.5, 
            cellPadding: 1.5, 
            halign: 'center', 
            valign: 'middle',
            textColor: textDark, 
            lineWidth: 0.2,
            lineColor: borderColor, 
            fontStyle: 'normal'
        };
        if (isMono) {
            globalStyles.lineWidth = 0.2;
        }

        // TABLE 1: GENERAL FLIGHT DATA
        doc.autoTable({
            startY: cursorY,
            margin: { top: 20, bottom: 20, left: 10, right: 10 },
            theme: 'grid',
            tableWidth: 190,
            head: [
                [{ content: 'GENERAL FLIGHT DATA & DISPATCH', colSpan: 8, styles: { fillColor: headerMain, textColor: textDark, fontStyle: 'bold', halign: 'center' } }],
                [
                    { content: 'FLIGHT ID', styles: { fillColor: subHeaderGray, textColor: textDark, halign: 'left', fontStyle: 'bold' } },
                    { content: 'DATE', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'EOBT', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'DEP', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'ARR', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'ALT 1', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'ALT 2', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'FUEL STATUS', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } }
                ]
            ],
            body: [[
                { content: this._getVal('flight-id'), styles: { fontStyle: 'normal', textColor: textDark, halign: 'left' } },
                { content: this._getVal('flight-date'), styles: { fontStyle: 'normal' } },
                { content: this._getVal('flight-time') + 'Z', styles: { fontStyle: 'normal' } },
                { content: this._getVal('airfield-dep'), styles: { fontStyle: 'normal' } },
                { content: this._getVal('airfield-arr'), styles: { fontStyle: 'normal' } },
                { content: this._getVal('airfield-alt1'), styles: { fontStyle: 'normal' } },
                { content: this._getVal('airfield-alt2'), styles: { fontStyle: 'normal' } },
                { content: fuelStatus, styles: { fontStyle: 'bold', textColor: statusTextColor, halign: 'center' } }
            ]],
            styles: globalStyles,
            columnStyles: { 0:{cellWidth:28},1:{cellWidth:24},2:{cellWidth:18},3:{cellWidth:20}, 4:{cellWidth:20},5:{cellWidth:22},6:{cellWidth:22},7:{cellWidth:36} }
        });
        cursorY = doc.lastAutoTable.finalY + 5;

        // TABLE 2: FUEL SUMMARY
        doc.autoTable({
            startY: cursorY,
            margin: { top: 20, bottom: 20, left: 10, right: 10 },
            theme: 'grid',
            head: [ 
                [ { content: 'FUEL SUMMARY', colSpan: 6, styles: { fillColor: headerMain, textColor: textDark, fontStyle: 'bold', halign: 'center' } }],
                [
                    { content: 'PHASE', styles: { fillColor: subHeaderGray, textColor: textDark, halign: 'left', fontStyle: 'bold' } },
                    { content: `AMOUNT (${unit})`, styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'TIME', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'PHASE', styles: { fillColor: subHeaderGray, textColor: textDark, halign: 'left', fontStyle: 'bold' } },
                    { content: `AMOUNT (${unit})`, styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } },
                    { content: 'TIME', styles: { fillColor: subHeaderGray, textColor: textDark, fontStyle: 'bold' } }
                ]
            ],
            body: [
                [{ content:'BLOCK', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.ramp), styles:{fontStyle:'normal'} }, { content:fmtTime(times.ramp), styles:{fontStyle:'normal'} }, { content:'ALTN', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.altern), styles:{fontStyle:'normal'} }, { content:fmtTime(times.altern), styles:{fontStyle:'normal'} }],
                [{ content:'TAXI', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.taxi), styles:{fontStyle:'normal'} }, { content:fmtTime(times.taxi), styles:{fontStyle:'normal'} }, { content:'FRF', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.reser), styles:{fontStyle:'normal'} }, { content:fmtTime(times.reser), styles:{fontStyle:'normal'} }],
                [{ content:'TOF', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.takeoffFuel), styles:{fontStyle:'normal'} }, { content:fmtTime(times.takeoff), styles:{fontStyle:'normal'} }, { content:'EXTRA', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.extraFuel), styles:{fontStyle:'normal'} }, { content:fmtTime(times.extra), styles:{fontStyle:'normal'} }],
                [{ content:'TRIP', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.totalTripFuel), styles:{fontStyle:'normal'} }, { content:fmtTime(times.trip), styles:{fontStyle:'normal'} }, { content:'MIN REQ', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.minRequiredFuel), styles:{fontStyle:'normal'} }, { content:fmtTime(times.minRequired), styles:{fontStyle:'normal'} }],
                [{ content:'CONT', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.cont), styles:{fontStyle:'normal'} }, { content:fmtTime(times.cont), styles:{fontStyle:'normal'} }, { content:'REM', styles:{fillColor:labelGray,halign:'left',fontStyle:'bold'} }, { content:fmtFuel(fuel.fuelAtDestination), styles:{fontStyle:'normal'} }, { content:fmtTime(times.fuelAtDestination), styles:{fontStyle:'normal'} }]
            ],
            styles: globalStyles,
            columnStyles: { 0:{cellWidth:45},1:{cellWidth:25},2:{cellWidth:25}, 3:{cellWidth:45},4:{cellWidth:25},5:{cellWidth:25} }
        });
        cursorY = doc.lastAutoTable.finalY + 5;

        // TABLE 3: NAVIGATION LOG
        const navLogBody = [];
        for (let i = 0; i < this.state.waypoints.length; i++) {
            const wp = this.state.waypoints[i];
            let wpName = wp.cachedName;
            if (!wpName) {
                if (i === 0) {
                    wpName = 'DEP';
                } else if (i === this.state.waypoints.length - 1) {
                    wpName = 'ARR';
                } else {
                    wpName = `WP${i+1}`;
                }
            }
            
            let numLabel = `${i+1}`;
            if (i === 0) {
                numLabel += ' [DEP]';
            } else if (i === this.state.waypoints.length - 1) {
                numLabel += ' [ARR]';
            }

            let fuelRem = '—';
            if (routeData.wpFuels) {
                fuelRem = FormatHelper.formatNumber(routeData.wpFuels[i], 1);
            }
            
            let etaVal = '—';
            if (routeData.wpETAs && routeData.wpETAs[i] !== undefined) {
                etaVal = routeData.wpETAs[i];
            }

            if (i === 0) {
                navLogBody.push([
                    { content: numLabel, styles: { fontStyle: 'normal', textColor: textDark } },
                    { content: wpName, styles: { fontStyle: 'normal', halign: 'left' } },
                    '—','—','—','—','—','—','—',
                    { content: etaVal, styles: { fontStyle: 'normal', halign: 'center' } },
                    '—',
                    { content: fuelRem, styles: { fontStyle: 'normal', halign: 'center' } }  
                ]);
            } else {
                const leg = routeData.legs ? routeData.legs[i - 1] : null;
                let legAlt = params.alt;
                if (wp.legCustoms && wp.legCustoms.alt) {
                    legAlt = wp.legCustoms.alt;
                }
                
                let trk = '—';
                let hdg = '—';
                let tas = '—';
                let gs = '—';
                let dist = '—';
                let ete = '—';
                let burn = '—';
                
                if (leg) {
                    trk = Math.round(leg.magTrack).toString().padStart(3,'0');
                    hdg = Math.round(leg.magHeading).toString().padStart(3,'0');
                    tas = Math.round(leg.tas);
                    gs = Math.round(leg.gs);
                    dist = FormatHelper.formatNumber(leg.distNM, 1);
                    ete = leg.timeStr;
                    burn = FormatHelper.formatNumber(leg.burn, 1);
                }

                navLogBody.push([
                    { content: numLabel, styles: { fontStyle: 'normal' } },
                    { content: wpName, styles: { halign: 'left', fontStyle: 'normal' } },
                    { content: trk, styles:{fontStyle:'normal'} },
                    { content: hdg, styles:{fontStyle:'normal'} },
                    { content: legAlt, styles: { fontStyle: 'normal' } },
                    { content: tas, styles:{fontStyle:'normal'} },
                    { content: gs, styles:{fontStyle:'normal'} }, 
                    { content: dist, styles:{fontStyle:'normal'} },
                    { content: ete, styles:{fontStyle:'normal'} },
                    { content: etaVal, styles: { fontStyle: 'normal' } },
                    { content: burn, styles:{fontStyle:'normal'} },
                    { content: fuelRem, styles: { fontStyle: 'normal', halign: 'center' } }
                ]);
            }
        }

        if (this.state.waypoints.length >= 2 && routeData.totals) {
            navLogBody.push([
                { content: 'TOTAL ROUTE', colSpan: 2, styles: { fontStyle: 'bold', fillColor: labelGray, halign: 'left' } },
                { content: '—', styles: { fillColor: labelGray } },
                { content: '—', styles: { fillColor: labelGray } },
                { content: '—', styles: { fillColor: labelGray } }, 
                { content: '—', styles: { fillColor: labelGray } },
                { content: '—', styles: { fillColor: labelGray } },
                { content: FormatHelper.formatNumber(routeData.totals.dist, 1), styles: { fontStyle: 'bold', fillColor: labelGray } },
                { content: routeData.totals.timeStr, styles: { fontStyle: 'bold', fillColor: labelGray } },
                { content: '—', styles: { fillColor: labelGray } },
                { content: FormatHelper.formatNumber(routeData.totals.burn, 1), styles: { fontStyle: 'bold', fillColor: labelGray } },
                { content: '—', styles: { fillColor: labelGray } }
            ]);
        }

        doc.autoTable({
            startY: cursorY,
            margin: { top: 20, bottom: 20, left: 10, right: 10 },
            theme: 'grid',
            tableWidth: 190,
            head: [
                [{ content: 'NAVIGATION LOG', colSpan: 12, styles: { fillColor: headerMain, textColor: textDark, fontStyle: 'bold', halign: 'center' } }],
                [
                    { content: '#', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} }, 
                    { content: 'WAYPOINT', styles:{fillColor:subHeaderGray,textColor:textDark,halign:'left',fontStyle:'bold'} },
                    { content: 'TRK (°M)', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: 'HDG (°M)', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: 'ALT (FT)', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: 'TAS (KT)', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: 'GS (KT)', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: 'DIST (NM)', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: 'ETE', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: 'ETA', styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: `BURN (${unit})`, styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} },
                    { content: `REM (${unit})`, styles:{fillColor:subHeaderGray,textColor:textDark,fontStyle:'bold'} }
                ]
            ], 
            body: navLogBody,
            styles: globalStyles,
            columnStyles: { 0:{cellWidth:14}, 1:{halign:'left',cellWidth:30}, 2:{cellWidth:13}, 3:{cellWidth:13}, 4:{cellWidth:14}, 5:{cellWidth:12}, 6:{cellWidth:12}, 7:{cellWidth:16}, 8:{cellWidth:14}, 9:{cellWidth:16}, 10:{cellWidth:17}, 11:{cellWidth:19} }
        });
        return doc.lastAutoTable.finalY;
    } 

    _savePDF(doc, flightId, suffix = '', fullFileName = '') {
        if (fullFileName) {
            doc.save(fullFileName);
        } else {
            // Original fallback behavior
            const dateStr = new Date().toISOString().slice(0, 10);
            let name = 'NAV_LOG';
            if (flightId) {
                name = flightId.replace(/[^a-zA-Z0-9_\-]/g, '_');
            }
            let finalSuffix = '';
            if (suffix) {
                finalSuffix = '_' + suffix;
            }
            doc.save(`OFP_${name}_${dateStr}${finalSuffix}.pdf`);
        }
    }

    async exportToPDFMap(mono = false, fullFileName = '') {
        try {
            const setup = this._setupPDF();
            const doc = setup.doc;
            const unit = setup.unit;
            
            this._addNavlogTablesToPDF(doc, unit, 20, mono);
            
            const mapOrientation = this._getOptimalMapOrientation();
            doc.addPage('a4', mapOrientation);
            
            const capture = await this._captureMapCanvas(mono, mapOrientation === 'l');
            this._addMapToPDF(doc, capture, mono);

            this._applyHeadersToAllPages(doc);
            this._applyFootersToAllPages(doc);

            let suffix = '';
            if (mono) {
                suffix = 'PRINT';
            }
            this._savePDF(doc, this._getVal('flight-id'), suffix, fullFileName);
        } finally {
            // Cleanup
        }
    }

    addHeader(doc) {
        const pageW = doc.internal.pageSize.width;
        
        // 1. Date and time
        const now = new Date();
        const zuluDate = now.toISOString().replace('T', ' ').substring(0, 16) + 'Z';
        
        // 2. First line
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(20);
        doc.text('Svaade Fly', 10, 15, { align: 'left' });
        
        // 3. Second line
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(20);
        doc.text(`Generated: ${zuluDate}`, 10, 18, { align: 'left' });
    }

    _applyHeadersToAllPages(doc) {
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            this.addHeader(doc);
        }
    }

    addFooter(doc, pageNumber, totalPages) {
        const pageW = doc.internal.pageSize.width;
        const pageH = doc.internal.pageSize.height;
        
        doc.setFontSize(7);
        doc.setTextColor(20);

        // Disclaimer
        const disclaimer = "Flight planning tool provided 'as-is' without liability for errors or omissions. The Pilot in Command (PIC) retains sole, final responsibility for flight safety, regulatory compliance, and independent data verification. Use constitutes acceptance of these terms.";

        doc.text(
            disclaimer,
            10,
            pageH - 15,
            { 
                align: 'left', 
                maxWidth: pageW * 3 / 4
            }
        );

        // Page number
        doc.text(
            `Page ${pageNumber} of ${totalPages}`,
            pageW - 10,
            pageH - 15,
            {
                align: 'right',
                maxWidth: pageW * 1 / 4
            }
        );
    }

    _applyFootersToAllPages(doc) {
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            this.addFooter(doc, i, totalPages);
        }
    }
}

// ============================================================================
//   8. APP CONTROLLER
// ============================================================================
class AppController {
    constructor(stateManager, geomagService, mapInstance) {
        this.state = stateManager;
        this.geomag = geomagService;
        this.map = mapInstance;
        // Initialize export manager
        this.pdfExporter = new PDFExporter(this.map, this.state, this);
    }

    getGlobalParams() {
        const eobtEl = document.getElementById('flight-time');
        let eobtStr = '00:00';
        if (eobtEl && eobtEl.value) {
            eobtStr = eobtEl.value;
        }
        
        const timeParts = eobtStr.split(':');
        const eobtHours = parseInt(timeParts[0], 10) || 0;
        const eobtMins = parseInt(timeParts[1], 10) || 0;
        const eobtTotalMinutes = (eobtHours * 60) + eobtMins;

        const taxiFuelEl = document.getElementById('global-taxi');
        let taxiFuel = 0;
        if (taxiFuelEl) {
            taxiFuel = parseFloat(taxiFuelEl.value) || 0;
        }

        const taxiFFEl = document.getElementById('global-taxi-ff');
        let taxiFF = 0;
        if (taxiFFEl) {
            taxiFF = parseFloat(taxiFFEl.value) || 0;
        }
        
        let taxiMinutes = 0;
        if (taxiFF > 0) {
            taxiMinutes = (taxiFuel / taxiFF) * 60;
        }

        const getVal = function(id, def) {
            const el = document.getElementById(id);
            if (el) {
                return parseFloat(el.value) || def;
            }
            return def;
        };

        return {
            alt: getVal('global-alt', 9500),
            ias: getVal('global-ias', 120),
            wdir: getVal('global-wdir', 0),
            wspd: getVal('global-wspd', 0),
            isa: getVal('global-isa', 0),
            ff: getVal('global-ff', 10),
            ramp: getVal('global-ramp', 0),
            taxi: taxiFuel,
            climb: getVal('global-climb', 0),
            desc: getVal('global-desc', 0),
            cont: getVal('global-cont', 0),
            altern: getVal('global-altern', 0),
            reser: getVal('global-reser', 0),
            ffHolding: getVal('global-ff-holding', 10),
            eobtMinutes: eobtTotalMinutes,
            taxiMinutes: Math.round(taxiMinutes)
        };
    }

    refreshApp() {
        try {
            const params = this.getGlobalParams();
            const routeData = FlightCalculator.computeRoute(this.state.waypoints, params);
            UIManager.updateNavLog(routeData, this.state.unit, this.map);
            UIManager.updateFuelPanel(routeData.fuel, this.state.unit);
        } catch (error) {
            console.error('RefreshApp error:', error);
        }
    }

    rebuildUI() {
        try {
            UIManager.rebuildNavLogDOM(this.state, this.state.unit);
            AppEventBinder.bindDynamicUIEvents(this);
        } catch (error) {
            console.error('RebuildUI error:', error);
        }
    }

    addWaypoint(lng, lat, cachedName = 'WAYPOINT', legCustoms = null, shouldFetchName = true) {
        const marker = new maplibregl.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(this.map);
        const label = document.createElement('div');
        label.className = 'wp-label';
        label.style.cssText = 'position:absolute; top:-28px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); padding:2px 6px; border-radius:4px; font-size:10px; font-weight:600; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.2);';
        marker.getElement().appendChild(label);

        const altEl = document.getElementById('global-alt');
        let alt = 9500;
        if (altEl) {
            alt = parseFloat(altEl.value) || 9500;
        }
        const magVar = this.geomag.getVariation(lat, lng, alt);

        const customDefaults = {
            alt: document.getElementById('global-alt')?.value || '9500',
            ias: document.getElementById('global-ias')?.value || '120',
            wdir: '0',
            wspd: '0',
            isa: '0',
            ff: document.getElementById('global-ff')?.value || ''
        };

        const newWP = {
            marker: marker,
            cachedName: cachedName,
            magVar: magVar,
            legCustoms: legCustoms || customDefaults
        };

        marker.on('dragend', () => {
            const coords = marker.getLngLat();
            const altElDrag = document.getElementById('global-alt');
            let altDrag = 9500;
            if (altElDrag) {
                altDrag = parseFloat(altElDrag.value) || 9500;
            }
            newWP.magVar = this.geomag.getVariation(coords.lat, coords.lng, altDrag);
            ExternalServices.fetchLocationName(coords.lng, coords.lat, newWP, this);
        });

        marker.on('drag', () => {
            this.rebuildUI();
            this.refreshApp();
        });

        this.state.addWaypoint(newWP);
        this.rebuildUI();

        if (shouldFetchName) {
            ExternalServices.fetchLocationName(lng, lat, newWP, this);
        }

        this.refreshApp();
    }

    deleteWaypoint(idx) {
        const wp = this.state.waypoints[idx];
        if (wp && wp.marker) {
            wp.marker.remove();
        }
        this.state.removeWaypointByIndex(idx);
        this.rebuildUI();
        this.refreshApp();
    }
}

// ============================================================================
//   9. MAP MANAGER
// ============================================================================
const MAP_CONFIG = {
    fonts: ['Noto Sans Regular'],
    sourceId: 'openaip-vector',
    vectorUrl: 'https://fly.svaade.com/libs/php/openaip-vector.php?z={z}&x={x}&y={y}'
};

const SVG_ICONS = {
    runway: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#475569" stroke-width="1.8"/><rect x="9.5" y="0" width="5" height="24" rx="1" fill="#475569" stroke="#ffffff" stroke-width="1.0"/></svg>`,
    airfield: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8.0" fill="none" stroke="#475569" stroke-width="1.8"/><rect x="9.5" y="4" width="5" height="16" rx="1" fill="#475569" stroke="#ffffff" stroke-width="1.0"/></svg>`,
    heliport: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#475569" stroke-width="1.0"/><text x="12" y="17" font-family="sans-serif" font-size="14" font-weight="regular" fill="#475569" text-anchor="middle">H</text></svg>`,
    vor: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="22,12 17,3.3 7,3.3 2,12 7,20.7 17,20.7" fill="none" stroke="#7c3aed" stroke-width="1.0"/><circle cx="12" cy="12" r="1.5" fill="#7c3aed"/></svg>`,
    dme: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="22" height="18" fill="none" stroke="#7c3aed" stroke-width="1.0"/></svg>`,
    vor_dme: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="22" height="18" fill="none" stroke="#7c3aed" stroke-width="1.0"/><polygon points="22,12 17,3.3 7,3.3 2,12 7,20.7 17,20.7" fill="none" stroke="#7c3aed" stroke-width="1.0"/><circle cx="12" cy="12" r="1.5" fill="#7c3aed"/></svg>`,
    ndb: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="2.75" fill="none" stroke="#7c3aed" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="0, 2.3"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#7c3aed" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="0, 2.3"/><circle cx="12" cy="12" r="8.25" fill="none" stroke="#7c3aed" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="0, 2.3"/><circle cx="12" cy="12" r="11" fill="none" stroke="#7c3aed" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="0, 2.3"/></svg>`,
    tacan: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><line x1="7" y1="3.3" x2="17" y2="3.3" stroke="#7c3aed" stroke-width="1.0" stroke-linecap="round"/><line x1="22" y1="12" x2="17" y2="20.7" stroke="#7c3aed" stroke-width="1.0" stroke-linecap="round"/><line x1="7" y1="20.7" x2="2" y2="12" stroke="#7c3aed" stroke-width="1.0" stroke-linecap="round"/><line x1="17" y1="3.3" x2="22" y2="12" stroke="#7c3aed" stroke-width="2.5" stroke-linecap="round"/><line x1="17" y1="20.7" x2="7" y2="20.7" stroke="#7c3aed" stroke-width="2.5" stroke-linecap="round"/><line x1="2" y1="12" x2="7" y2="3.3" stroke="#7c3aed" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="1.5" fill="#7c3aed"/></svg>`
};

const AIRSPACE_COLOR_EXPRESSION = [
    'match',
    ['upcase', ['to-string', ['get', 'type']]],
    ['1', '2', '3', 'RESTRICTED', 'DANGER', 'PROHIBITED', 'R', 'D', 'P'], '#dc2626',
    ['4', 'CTR', 'MCTR'], '#0284c7',
    ['5', '6', 'TMA', 'CTA'], '#7c3aed',
    ['10', '11', 'ATZ', 'MATZ'], '#0ea5e9',
    ['16', '17', 'RMZ', 'TMZ'], '#f59e0b',
    '#64748b' // Default
];

// ============================================================================
//   CUSTOM TERRAIN TOGGLE CONTROL
// ============================================================================
class TerrainToggleControl {
    constructor() {
        this._map = null;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    }

    onAdd(map) {
        this._map = map;
        const btn = document.createElement('button');
        btn.className = 'maplibregl-ctrl-terrain-toggle';
        btn.type = 'button';
        btn.title = 'Desactivar Terreo 3D';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" transform="scale(0.7)"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`;
        
        btn.addEventListener('click', this._toggle.bind(this));
        this._container.appendChild(btn);
        
        this._updateState();
        const updateOnIdle = () => {
            this._updateState();
            this._map.off('idle', updateOnIdle); 
        };
        
        this._map.on('idle', updateOnIdle);
        return this._container;
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    _toggle() {
        const currentTerrain = this._map.getTerrain();
        if (currentTerrain) {
            // Disable 3D terrain
            this._map.setTerrain(null);
        } else {
            // Enable 3D terrain
            this._map.setTerrain({ source: 'terrain-source', exaggeration: 1.2 });
        }
        this._updateState();
    }

    _updateState() {
        const btn = this._container.querySelector('button');
        if (!btn)
            return;
        const hasTerrain = !!this._map.getTerrain();
        btn.title = hasTerrain ? 'Disable 3D terrain' : 'Enable 3D terrain';
        btn.classList.toggle('is-active', hasTerrain);
    }
}

class MapManager {
    constructor() {
        this.map = null;
        this.openaipLayerIds = [
            'openaip-airspaces-fill',
            'openaip-airspaces-glow',
            'openaip-airspaces-labels',
            'openaip-airports',
            'openaip-airports-labels',
            'openaip-navaids',
            'openaip-navaids-labels'
        ];
    }

    initMap(onLoadCallback) {
        this.contourDemSource = new mlcontour.DemSource({
            url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
            encoding: 'terrarium',
            maxzoom: 12
        });

        this.contourDemSource.setupMaplibre(maplibregl);

        this.map = new maplibregl.Map({
            container: 'map',
            style: 'https://tiles.openfreemap.org/styles/positron',
            center: [-8.6275, 42.229166667],
            zoom: 6,
            preserveDrawingBuffer: true,
            attributionControl: false
        });

        const scale = new maplibregl.ScaleControl({
            maxWidth: 150,
            unit: 'nautical'
        });
        this.map.addControl(scale, 'bottom-left');

        const navControl = new maplibregl.NavigationControl({
            visualizePitch: true,
            showCompass: true,
            showZoom: true
        });
        this.map.addControl(navControl, 'top-right');

        const terrainControl = new TerrainToggleControl();
        this.map.addControl(terrainControl, 'top-right');

        const attribution = new maplibregl.AttributionControl({
            compact: true, 
            customAttribution: '© OpenAIP'
        });
        this.map.addControl(attribution, 'bottom-right');

        this.map.on('load', () => {

            this.map.addSource('terrain-source', {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 14
            });

            this.map.setTerrain({ source: 'terrain-source', exaggeration: 1.2 });

            this._setupSources();
            this._loadIcons();
            
            this._addAirspaceLayers();
            this._addAirportLayers();
            this._addNavaidLayers();
            this._addRouteLayer();
            this._addMeasureLayers();
            this._addContourLayers();

            if (onLoadCallback) {
                onLoadCallback(this.map);
            }
        });
    }

    _setupSources() {
        this.map.addSource(MAP_CONFIG.sourceId, {
            type: 'vector',
            tiles: [MAP_CONFIG.vectorUrl],
            minzoom: 0,
            maxzoom: 14
        });
    }

    _loadIcons() {
        this._addSvgToMap('runway-icon', SVG_ICONS.runway);
        this._addSvgToMap('airfield-icon', SVG_ICONS.airfield);
        this._addSvgToMap('heliport-icon', SVG_ICONS.heliport);
        this._addSvgToMap('vor-icon', SVG_ICONS.vor);
        this._addSvgToMap('dme-icon', SVG_ICONS.dme);
        this._addSvgToMap('vor_dme-icon', SVG_ICONS.vor_dme);
        this._addSvgToMap('ndb-icon', SVG_ICONS.ndb);
        this._addSvgToMap('tacan-icon', SVG_ICONS.tacan);
    }

    _addSvgToMap(id, svgString) {
        const img = new Image(24, 24);
        img.onload = () => {
            if (!this.map.hasImage(id)) {
                this.map.addImage(id, img);
            }
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    }

    _addAirspaceLayers() {
        const sourceLayer = 'airspaces';
        const minZoom = 5.0;

        this.map.addLayer({
            id: 'openaip-airspaces-fill',
            type: 'fill',
            source: MAP_CONFIG.sourceId,
            'source-layer': sourceLayer,
            minzoom: minZoom,
            paint: { 'fill-color': AIRSPACE_COLOR_EXPRESSION, 'fill-opacity': 0.05 }
        });

        this.map.addLayer({
            id: 'openaip-airspaces-glow',
            type: 'line',
            source: MAP_CONFIG.sourceId,
            'source-layer': sourceLayer,
            minzoom: minZoom,
            paint: { 'line-color': AIRSPACE_COLOR_EXPRESSION, 'line-width': 1.0, 'line-opacity': 0.8 }
        });

        this.map.addLayer({
            id: 'openaip-airspaces-labels', 
            type: 'symbol',
            source: MAP_CONFIG.sourceId,
            'source-layer': sourceLayer,
            minzoom: minZoom,
            layout: {
                'text-font': MAP_CONFIG.fonts,
                'text-field': [
                    'format',
                    ['get', 'name_label_full'], { 'font-scale': 1.1 }, '\n', {},
                    ['to-string', ['get', 'lower_limit_unit']], ['to-string', ['get', 'lower_limit_value']], ' / ', {},
                    ['to-string', ['get', 'upper_limit_unit']], ['to-string', ['get', 'upper_limit_value']]
                ],
                'text-size': 10,
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#1e293b',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.0
            }
        });
    }

    _addAirportLayers() {
        const sourceLayer = 'airports';
        const minZoom = 7.5; 

        this.map.addLayer({
            id: 'openaip-airports',
            type: 'symbol',
            source: MAP_CONFIG.sourceId,
            'source-layer': sourceLayer,
            minzoom: minZoom,
            layout: {
                'text-font': MAP_CONFIG.fonts,
                'icon-image': [
                    'match',
                    ['get', 'type'], 
                    'airport', 'runway-icon',
                    'light_aircraft', 'airfield-icon',
                    'heli_civil', 'heliport-icon', 
                    'heli_mil', 'heliport-icon',
                    'runway-icon'
                ],
                'icon-size': 1.0,
                'icon-rotate': ['get', 'runway_rotation'],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-pitch-alignment': 'map'
            }
        });

        this.map.addLayer({
            id: 'openaip-airports-labels',
            type: 'symbol',
            source: MAP_CONFIG.sourceId,
            'source-layer': sourceLayer,
            minzoom: minZoom,
            layout: {
                'text-field': ['get', 'name_label_full'], 
                'text-font': MAP_CONFIG.fonts,
                'text-size': 11,
                'text-offset': [0, 1.3],
                'text-anchor': 'top'
            },
            paint: { 
                'text-color': [
                    'match',
                    ['get', 'type'],
                    'airport', '#475569',
                    'light_aircraft', '#475569',
                    'heli_civil', '#475569',
                    'heli_mil', '#475569',
                    '#475569'
                ],
                'text-halo-color': '#ffffff', 
                'text-halo-width': 1.0 
            }
        });
    }

    _addNavaidLayers() {
        const sourceLayer = 'navaids';
        const minZoom = 6.0;

        this.map.addLayer({
            id: 'openaip-navaids', 
            type: 'symbol',
            source: MAP_CONFIG.sourceId,
            'source-layer': sourceLayer,
            minzoom: minZoom,
            layout: {
                'text-font': MAP_CONFIG.fonts,
                'icon-image': [
                    'match',
                    ['upcase', ['to-string', ['get', 'type']]],
                    'VOR', 'vor-icon',
                    'DME', 'dme-icon',
                    'VOR_DME', 'vor_dme-icon',
                    'TACAN', 'tacan-icon',
                    'NDB', 'ndb-icon',
                    'vor-icon' 
                ],
                'icon-size': 0.7,
                'icon-allow-overlap': true,
                'icon-pitch-alignment': 'map'
            }
        });

        this.map.addLayer({
            id: 'openaip-navaids-labels',
            type: 'symbol',
            source: MAP_CONFIG.sourceId,
            'source-layer': 'navaids',
            minzoom: minZoom,
            layout: {
                'text-field': ['to-string', ['get', 'name_label_full']],
                'text-font': MAP_CONFIG.fonts,
                'text-size': 10,
                'text-offset': [0, 0.8],
                'text-anchor': 'top'
            },
            paint: { 
                'text-color': [
                    'match',
                    ['upcase', ['to-string', ['get', 'type']]],
                    'VOR', '#7c3aed',
                    'DME', '#7c3aed',
                    'VOR_DME', '#7c3aed',
                    'TACAN', '#7c3aed',
                    'NDB', '#7c3aed',
                    '#7c3aed'
                ],
                'text-halo-color': '#ffffff', 
                'text-halo-width': 1.0 
            }
        });
    }

    _addRouteLayer() {
        this.map.addSource('route', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
        });
        
        this.map.addLayer({ 
            id: 'route-line', 
            type: 'line', 
            source: 'route', 
            paint: { 'line-color': '#007bff', 'line-width': 4 } 
        });
    }

    _addMeasureLayers() {
        this.map.addSource('measure-geo', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // Layer for the dashed line (Leg bearing)
        this.map.addLayer({
            id: 'measure-line-layer',
            type: 'line',
            source: 'measure-geo',
            paint: {
                'line-color': '#ff0055',
                'line-width': 2.5,
                'line-dasharray': [2, 2]
            },
            filter: ['==', '$type', 'LineString']
        });

        // Layer for origin and destination points
        this.map.addLayer({
            id: 'measure-points-layer',
            type: 'circle',
            source: 'measure-geo',
            paint: {
                'circle-radius': 5,
                'circle-color': '#ff0055',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff'
            },
            filter: ['==', '$type', 'Point']
        });
    }

    _addContourLayers() {
        this.map.addSource('contour-source', {
            type: 'vector',
            tiles: [
                this.contourDemSource.contourProtocolUrl({
                    thresholds: {
                        4: [305, 305],
                        8: [61, 305]
                    },
                    elevationKey: 'ele',
                    levelKey: 'level',
                    contourLayer: 'contours'
                })
            ],
            maxzoom: 15
        });

        // Lines layer
        this.map.addLayer({
            id: 'contours-lines',
            type: 'line',
            source: 'contour-source',
            'source-layer': 'contours',
            filter: ['>', ['get', 'ele'], 0],
            paint: {
                'line-color': '#404040',
                'line-width': ['match', ['get', 'level'], 1, 1.0, 0.4],
                'line-opacity': ['match', ['get', 'level'], 1, 0.5, 0.4]
            }
        }, 'openaip-airspaces-fill');

        // Labels layer
        this.map.addLayer({
            id: 'contours-labels',
            type: 'symbol',
            source: 'contour-source',
            'source-layer': 'contours',
            filter: [
                'all', 
                ['==', ['get', 'level'], 1],
                ['>', ['get', 'ele'], 0]
            ],
            layout: {
                'symbol-placement': 'line',
                'text-field': [
                    'concat', 
                    ['to-string', ['*', ['round', ['/', ['*', ['get', 'ele'], 3.28084], 1000]], 1000]], 
                    'ft'
                ],
                'text-font': MAP_CONFIG.fonts,
                'text-size': 11,
                'text-pitch-alignment': 'viewport',
                'text-rotation-alignment': 'viewport',
                'text-keep-upright': true,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-max-angle': 180
            },
            paint: {
                'text-color': '#404040',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.0
            }
        });
    }
    
    toggleOpenAIP(isVisible) {
        this.setLayersVisibility(this.openaipLayerIds, isVisible);
    }

    setLayersVisibility(layerIds, isVisible) {
        let visibility = 'none';
        if (isVisible) {
            visibility = 'visible';
        }
        layerIds.forEach((layerId) => {
            if (this.map && this.map.getLayer(layerId)) {
                this.map.setLayoutProperty(layerId, 'visibility', visibility);
            }
        });
    }
}

// ============================================================================
//   10. KML MANAGER
// ============================================================================
class KmlManager {
    constructor(mapInstance, stateManager, getFileNameFn) {
        this.map = mapInstance;
        this.stateManager = stateManager;
        this.getFileNameFn = getFileNameFn;
    }

    importKml(displayName, kmlText) {
        const features = this._parseKmlToGeoJSON(kmlText);
        if (!features || features.length === 0) {
            alert('No valid elements found (Point, LineString, or Polygon) in the KML.');
            return null;
        }

        const layerConfig = this._generateLayerIds(displayName);
        this._addMapLayers(layerConfig, features);
        this._setupPopup(layerConfig);  
        this._addUiControls(displayName, features, layerConfig);
        this._fitMapToBounds(features);

        return layerConfig;
    }

    removeKml(layerConfig) {
        if (layerConfig.eventHandlers) {
            for (const [layerId, handlers] of Object.entries(layerConfig.eventHandlers)) {
                this.map.off('mouseenter', layerId, handlers.onMouseEnter);
                this.map.off('mouseleave', layerId, handlers.onMouseLeave);
            }
        }

        layerConfig.layerIds.forEach((id) => {
            if (this.map.getLayer(id)) {
                this.map.removeLayer(id);
            }
        });
        if (this.map.getSource(layerConfig.sourceId)) {
            this.map.removeSource(layerConfig.sourceId);
        }
        if (layerConfig.uiElement) {
            layerConfig.uiElement.remove();
        }
    }

    _parseKmlToGeoJSON(kmlText) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(kmlText, 'text/xml');

            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                throw new Error('The file has an invalid XML format.');
            }

            const geojson = toGeoJSON.kml(xmlDoc);

            if (!geojson || !geojson.features || geojson.features.length === 0) {
                return []; 
            }

            return geojson.features;

        } catch (error) {
            console.error('Error processing KML:', error);
            throw error;
        }
    }

    _generateLayerIds(displayName) {
        const id = 'kml-' + Date.now();
        return {
            sourceId: id + '-src',
            layerIds: [id + '-fill', id + '-outline', id + '-point', id + '-label'],
            hoverLayers: [id + '-point', id + '-outline'],
            uiElement: null
        };
    }

    _addMapLayers(config, features) {
        const geojson = { type: 'FeatureCollection', features: features };
        this.map.addSource(config.sourceId, { type: 'geojson', data: geojson });

        // Fill (Polygons)
        this.map.addLayer({ id: config.layerIds[0], type: 'fill', source: config.sourceId, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.15 } });
        // Lines
        this.map.addLayer({ id: config.layerIds[1], type: 'line', source: config.sourceId, filter: ['any', ['==', '$type', 'Polygon'], ['==', '$type', 'LineString']], paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [2, 2] } });
        // Points
        this.map.addLayer({ id: config.layerIds[2], type: 'circle', source: config.sourceId, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#2563eb', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
        // Labels
        this.map.addLayer({ id: config.layerIds[3], type: 'symbol', source: config.sourceId, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    }

    _setupPopup(layerConfig) { 
        const hoverLayers = layerConfig.hoverLayers;
        layerConfig.eventHandlers = {};

        const popup = new maplibregl.Popup({ 
            closeButton: false, 
            closeOnClick: false, 
            offset: [0, -15] 
        });

        hoverLayers.forEach((layerId) => {
            const onMouseEnter = (e) => {
                this.map.getCanvas().style.cursor = 'pointer';
                const rendered = this.map.queryRenderedFeatures(e.point, { layers: [layerId] });
                const feature = rendered[0];
                if (!feature) {
                    return;
                }

                let coords = e.lngLat;
                if (feature.geometry.type === 'Point') {
                    coords = feature.geometry.coordinates;
                }
                
                const name = feature.properties.name || 'KML Element';
                const desc = feature.properties.description || '';
                
                let html = `<div style="min-width:140px;font-family:system-ui,sans-serif;"><strong style="font-size:12px;">${DOMUtils.escapeHtml(name)}</strong>`;
                if (desc) {
                    html += `<div style="margin-top:6px;white-space:pre-wrap;color:#334155;font-size:11px;line-height:1.4;">${DOMUtils.escapeHtml(desc)}</div>`;
                }
                html += `</div>`;

                popup.setLngLat(coords).setHTML(html).addTo(this.map);
            };

            const onMouseLeave = () => {
                this.map.getCanvas().style.cursor = '';
                popup.remove();
            };

            this.map.on('mouseenter', layerId, onMouseEnter);
            this.map.on('mouseleave', layerId, onMouseLeave);

            layerConfig.eventHandlers[layerId] = {
                onMouseEnter: onMouseEnter,
                onMouseLeave: onMouseLeave
            };
        });
    }
 
    _addUiControls(displayName, features, config) {
        const list = document.getElementById('layers-list');
        if (!list) {
            return;
        }

        const itemBox = document.createElement('div'); 
        itemBox.className = 'wp-box';
        itemBox.innerHTML = `
            <div class="kml-table" style="border-left: 2px solid #cbd5e1; grid-template-columns: 50px 1fr 40px; display: grid;">
                <div class="cell" style="display:flex; align-items:center; justify-content:center;">
                    <label class="toggle-switch"><input type="checkbox" checked><span class="slider"></span></label>
                </div>
                <div class="cell" style="justify-content:center; align-items:flex-start;">
                    <span style="font-weight:600; color:#0f172a; font-size:0.85em;">${DOMUtils.escapeHtml(displayName)} (${features.length})</span>
                </div>
                <div class="delete-cell" style="display:flex; align-items:center; justify-content:center; background:#f8fafc;">
                    <button type="button" class="btn-delete-wp" title="Delete layer">✕</button>
                </div>
            </div>`;
        
        list.appendChild(itemBox);
        config.uiElement = itemBox;

        const checkbox = itemBox.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
            let visibility = 'none';
            if (e.target.checked) {
                visibility = 'visible';
            }
            config.layerIds.forEach((id) => { 
                if (this.map.getLayer(id)) {
                    this.map.setLayoutProperty(id, 'visibility', visibility); 
                }
            });
        });

        const deleteBtn = itemBox.querySelector('.btn-delete-wp');
        deleteBtn.addEventListener('click', () => {
            this.removeKml(config);
        });
    }

    _fitMapToBounds(features) {
        try {
            if (features && features.length > 0) {
                const geojson = { type: 'FeatureCollection', features: features };
                const bbox = turf.bbox(geojson);
                this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, maxZoom: 12 });
            }
        } catch (error) {
            console.warn('Could not calculate KML bounds:', error);
        }
    }

    exportToKml(fullFileName = '') {
        if (!this.stateManager.waypoints || this.stateManager.waypoints.length < 2) {
            alert("You need at least 2 waypoints to export a KML route.");
            return;
        }

        const geojson = {
            type: 'FeatureCollection',
            features: []
        };

        const routeCoords = this.stateManager.waypoints.map((wp) => {
            const lngLat = wp.marker.getLngLat();
            return [lngLat.lng, lngLat.lat];
        });

        const flightIdEl = document.getElementById('flight-id');
        let flightId = 'FlightPlan';
        if (flightIdEl && flightIdEl.value.trim()) {
            flightId = flightIdEl.value.trim();
        }

        geojson.features.push({
            type: 'Feature',
            properties: {
                name: `Route: ${flightId}`,
                description: `Generated by Svaade Fly`,
                stroke: '#007bff',
                'stroke-width': 4,
                'stroke-opacity': 0.8
            },
            geometry: {
                type: 'LineString', 
                coordinates: routeCoords
            }
        });

        this.stateManager.waypoints.forEach((wp, index) => {
            const lngLat = wp.marker.getLngLat();
            let label = `WP${index + 1}`;
            if (index === 0) {
                label = 'DEP';
            } else if (index === this.stateManager.waypoints.length - 1) {
                label = 'ARR';
            }
            
            let name = wp.cachedName;
            if (!name) {
                name = label;
            }
            
            let alt = 'N/A';
            if (wp.legCustoms && wp.legCustoms.alt) {
                alt = wp.legCustoms.alt;
            }

            geojson.features.push({
                type: 'Feature',
                properties: {
                    name: `${label}: ${name}`,
                    description: `Altitude: ${alt} ft\nCoords: ${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`
                },
                geometry: {
                    type: 'Point',
                    coordinates: [lngLat.lng, lngLat.lat]
                }
            });
        });

        const kmlString = tokml(geojson, {
            documentName: flightId,
            documentDescription: 'Generated by Svaade Fly',
            simplestyle: true
        });

        const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        let fileName = fullFileName;
        if (!fileName) {
            fileName = this.getFileNameFn();
        } else if (!fileName.toLowerCase().endsWith('.kml')) {
            fileName += '.kml';
        }
        
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// ============================================================================
//   11. APP EVENT BINDER (New Class for cleaner Bootstrapper)
// ============================================================================
class AppEventBinder {
    static bindGlobalEvents(flightPlanner) {
        flightPlanner.map.on('click', (e) => {
            if (flightPlanner.measureTool && flightPlanner.measureTool.isMeasuring) {
                return;
            }
            flightPlanner.addWaypointAt(e.lngLat.lng, e.lngLat.lat);
        });

        // Hamburger menu management
        const menuToggle = document.getElementById('menu-toggle');
        const headerMenu = document.getElementById('header-menu');
        
        if (menuToggle && headerMenu) {
            menuToggle.addEventListener('click', (e) => {
                e.stopPropagation(); 
                headerMenu.classList.toggle('show');
            });

            document.addEventListener('click', (e) => {
                if (!menuToggle.contains(e.target) && !headerMenu.contains(e.target)) {
                    headerMenu.classList.remove('show');
                }
            });
            
            const menuActions = headerMenu.querySelectorAll('.action-btn');
            menuActions.forEach((btn) => {
                btn.addEventListener('click', () => {
                    // Do not close automatically if it is the NEW button
                    if (btn.id !== 'btn-new') {
                        headerMenu.classList.remove('show');
                    }
                });
            });
        }

        const inputIds = [
            'flight-time', 'global-alt', 'global-ias', 'global-wdir', 
            'global-wspd', 'global-isa'
        ];
 
        inputIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    flightPlanner.refreshApp();
                });
            }
        });

        const fuelInputIds = [
            'global-ff', 'global-taxi-ff', 'global-ff-holding', 'global-ramp', 'global-taxi',
            'global-climb', 'global-desc', 'global-cont', 'global-altern', 'global-reser'
        ];

        fuelInputIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    // SAVE THE EXACT VALUE IN THE BASE STATE BEFORE REFRESHING
                    flightPlanner.stateManager.updateBaseFuelValue(id, el.value);
                    flightPlanner.refreshApp();
                });
            }
        });

        const btnExportColor = document.getElementById('btn-export-color');
        if (btnExportColor) {
            btnExportColor.addEventListener('click', () => {
                flightPlanner.triggerPdfSaveFlow('color');
            });
        }

        const btnExportMono = document.getElementById('btn-export-mono');
        if (btnExportMono) {
            btnExportMono.addEventListener('click', () => {
                flightPlanner.triggerPdfSaveFlow('mono');
            });
        }

        const btnReverse = document.getElementById('btn-reverse-route');
        if (btnReverse) {
            btnReverse.addEventListener('click', () => {
                flightPlanner.reverseWaypoints();
            });
        }

        const btnNew = document.getElementById('btn-new');
        let confirmTimeout;
        if (btnNew) {
            btnNew.addEventListener('click', () => {
                // 1. Check if the panel is already empty
                const hasWaypoints = flightPlanner.stateManager.waypoints.length > 0;
                const deleteBtns = document.querySelectorAll('#layers-list .btn-delete-wp');
                const hasKmls = deleteBtns.length > 0;

                if (!hasWaypoints && !hasKmls) {
                    flightPlanner.clearAllWaypoints();
                    return;
                }

                const spanText = btnNew.querySelector('span');

                if (btnNew.classList.contains('is-confirming')) {
                    clearTimeout(confirmTimeout);
                    btnNew.classList.remove('is-confirming');
                    spanText.innerText = 'Clear';
                    flightPlanner.clearAllWaypoints();
                } else {
                    btnNew.classList.add('is-confirming');
                    spanText.innerText = 'SURE?';
                    
                    confirmTimeout = setTimeout(() => {
                        btnNew.classList.remove('is-confirming');
                        spanText.innerText = 'Clear';
                    }, 3000);
                }
            });
        }

        const openaipLayerGroups = {
            'chk-airspaces': ['openaip-airspaces-fill', 'openaip-airspaces-glow', 'openaip-airspaces-labels'],
            'chk-airports': ['openaip-airports', 'openaip-airports-labels'],
            'chk-navaids': ['openaip-navaids', 'openaip-navaids-labels']
        };

        Object.entries(openaipLayerGroups).forEach(([checkboxId, layerIds]) => {
            const checkbox = document.getElementById(checkboxId);
            if (!checkbox) {
                return;
            }
            checkbox.addEventListener('change', () => {
                flightPlanner.mapManager.setLayersVisibility(layerIds, checkbox.checked);
            });
        });

        const contourCheckbox = document.getElementById('chk-contours');

        if (contourCheckbox) {
            contourCheckbox.addEventListener('change', (e) => {
                const visibility = e.target.checked ? 'visible' : 'none';
                
                if (flightPlanner.map && flightPlanner.map.getLayer('contours-lines')) {
                    flightPlanner.map.setLayoutProperty('contours-lines', 'visibility', visibility);
                }
                if (flightPlanner.map && flightPlanner.map.getLayer('contours-labels')) {
                    flightPlanner.map.setLayoutProperty('contours-labels', 'visibility', visibility);
                }
            });
        }

        const btnSave = document.getElementById('btn-save');
        if (btnSave) {
            btnSave.addEventListener('click', (e) => {
                e.preventDefault();
                flightPlanner.savePlanToJson();
            });
        }

        const btnLoadJson = document.getElementById('btn-load-json');
        const inputJson = document.getElementById('input-json');
        if (btnLoadJson && inputJson) {
            btnLoadJson.addEventListener('click', () => {
                inputJson.click();
            });
            inputJson.addEventListener('change', (e) => {
                flightPlanner.handleJsonFileLoad(e.target.files[0]);
            });
        }

        const btnLoadKml = document.getElementById('btn-load-kml');
        const inputKml = document.getElementById('input-kml');
        if (btnLoadKml && inputKml) {
            btnLoadKml.addEventListener('click', () => {
                inputKml.click();
            });
            inputKml.addEventListener('change', (e) => {
                flightPlanner.handleKmlFileLoad(e.target.files[0]);
            });
        }

        const btnExportKml = document.getElementById('btn-export-kml');
        if (btnExportKml) {
            btnExportKml.addEventListener('click', () => {
                flightPlanner.triggerKmlSaveFlow(); 
            });
        }

        const unitSelector = document.getElementById('unit-selector');
        const fuelTypeSelector = document.getElementById('fuel-type-selector');
        if (unitSelector && fuelTypeSelector) {
            unitSelector.addEventListener('change', () => {
                flightPlanner.handleFuelConfigChange();
            });
            fuelTypeSelector.addEventListener('change', () => {
                flightPlanner.handleFuelConfigChange();
            });
        }

        const ffLabels = {
            'global-taxi-ff': 'TAXI',
            'global-ff': 'CRZ',
            'global-ff-holding': 'HOLD'
        };
        
        for (const [id, baseText] of Object.entries(ffLabels)) {
            const inputEl = document.getElementById(id);
            if (inputEl && inputEl.previousElementSibling) {
                inputEl.previousElementSibling.innerText = `${baseText} (${flightPlanner.stateManager.unit}/H)`;
            }
        }
    }

    static bindDynamicUIEvents(controller) {
        const legInputs = document.querySelectorAll('.leg-param-input');
        legInputs.forEach((input) => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.idx, 10);
                const prop = e.target.dataset.prop;
                if (controller.state.waypoints[idx]) {
                    controller.state.waypoints[idx].legCustoms[prop] = e.target.value;
                    controller.refreshApp();
                }
            });
        });

        const deleteButtons = document.querySelectorAll('.btn-delete-wp');
        deleteButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                controller.deleteWaypoint(parseInt(e.target.dataset.idx, 10));
            });
        });

        const nameInputs = document.querySelectorAll('.wp-name-input');
        nameInputs.forEach((input) => {
            input.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.idx, 10);
                if (controller.state.waypoints[idx]) {
                    controller.state.waypoints[idx].cachedName = e.target.value;
                    UIManager.updateMarkerLabels(controller.state.waypoints);
                }
            });
        });

        const coordInputs = document.querySelectorAll('.wp-coord-input');
        coordInputs.forEach((input) => {
            input.addEventListener('change', (e) => {
                const idx = e.target.dataset.idx;
                const wp = controller.state.waypoints[idx];
                if (!wp) {
                    return;
                }

                const latEl = document.querySelector(`.wp-coord-input[data-idx="${idx}"][data-axis="lat"]`);
                const lngEl = document.querySelector(`.wp-coord-input[data-idx="${idx}"][data-axis="lng"]`);

                const lat = parseFloat(latEl.value);
                const lng = parseFloat(lngEl.value);

                if (!isNaN(lat) && !isNaN(lng)) {
                    wp.marker.setLngLat([lng, lat]);
                    ExternalServices.fetchLocationName(lng, lat, wp, controller);
                }
            });
        });
    }
}

// ============================================================================
//   12. MAIN APPLICATION BOOTSTRAPPER
// ============================================================================
const FLIGHT_PLAN_FIELDS = [
    'flight-id', 'flight-date', 'flight-time', 'airfield-dep',
    'airfield-arr', 'airfield-alt1', 'airfield-alt2', 'global-taxi-ff',
    'global-alt', 'global-ias', 'global-wdir', 'global-wspd',
    'global-isa', 'global-ff', 'global-ff-holding', 'global-ramp',
    'global-taxi', 'global-climb', 'global-desc', 'global-cont',
    'global-altern', 'global-reser'
];

class FlightPlanner {
    constructor() {
        this.stateManager = new StateManager();
        this.geomagService = new GeomagService();
        this.geomagService.initialize();
        this.mapManager = new MapManager();
        this.map = null;
        this.controller = null;
        this.openaipVisible = true;
        this.kmlManager = null;
        this.measureTool = null;
        this.initApp();
    }

    async initApp() {
        await this.geomagService.initialize();

        this.mapManager.initMap((readyMap) => {
            this.map = readyMap;
            this.kmlManager = new KmlManager(
                this.map, 
                this.stateManager, 
                () => this.getAeronauticalBaseName('KML')
            );
            this.controller = new AppController(this.stateManager, this.geomagService, this.map);
            this.measureTool = new MeasureTool(this.map, this.geomagService);
            AppEventBinder.bindGlobalEvents(this);
            this.initMobileTabs();
            this.rebuildUI();
            this.refreshApp();
            this.mapManager.toggleOpenAIP(this.openaipVisible);
        });
    }

    addWaypointAt(lng, lat) {
        this.controller.addWaypoint(lng, lat);
    }

    clearAllWaypoints() {
        this.stateManager.waypoints.forEach((wp) => {
            if (wp.marker) {
                wp.marker.remove();
            }
        });
        this.stateManager.clearWaypoints();
        this.rebuildUI();
        this.refreshApp();
    }

    reverseWaypoints() {
        if (this.stateManager.waypoints.length < 2) {
            return;
        }

        // 1. Extract current leg inputs (ignoring index 0, which is departure and has no arrival leg)
        const legCustomsArray = [];
        for (let i = 1; i < this.stateManager.waypoints.length; i++) {
            // Make a shallow copy of the object to avoid reference issues
            legCustomsArray.push({ ...this.stateManager.waypoints[i].legCustoms });
        }

        // 2. Reverse the order of waypoints
        this.stateManager.waypoints.reverse();

        // 3. Also reverse the order of the extracted leg inputs
        // This ensures that the physical leg (e.g., between A and B) keeps its inputs, 
        // now applied to the new direction (from B to A).
        legCustomsArray.reverse();

        // 4. Reassign inputs to the destination waypoints of the new legs
        const globalDefaults = {
            alt: document.getElementById('global-alt')?.value || '9500',
            ias: document.getElementById('global-ias')?.value || '120',
            wdir: '0',
            wspd: '0',
            isa: '0',
            ff: document.getElementById('global-ff')?.value || ''
        };

        // The new departure point (index 0) receives clean default values
        this.stateManager.waypoints[0].legCustoms = { ...globalDefaults };

        // Assign the reversed inputs to the remaining waypoints (which are now leg destinations)
        for (let i = 1; i < this.stateManager.waypoints.length; i++) {
            this.stateManager.waypoints[i].legCustoms = legCustomsArray[i - 1];
        }

        // 5. Re-render the UI and recalculate the route 
        UIManager.swapDepArrInputs();
        this.rebuildUI();
        this.refreshApp();
    }

    executeDownload(fileName, jsonString) {
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = url;
        downloadAnchor.download = fileName; 
        
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        
        document.body.removeChild(downloadAnchor);
        URL.revokeObjectURL(url);
        console.log('File [' + fileName + '] successfully downloaded.');
    }

    getAeronauticalBaseName(suffix = '') {
        const flightIdEl = document.getElementById('flight-id');
        let flightId = 'New_Route';
        if (flightIdEl) {
            const val = flightIdEl.value.trim();
            if (val) {
                flightId = val;
            }
        }
        
        const cleanFlightId = flightId.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'New_Route';
        const now = new Date();
        const zuluTimestamp = now.toISOString().slice(0, 10).replace(/-/g, '') + 'T' + now.toISOString().slice(11, 16).replace(/:/g, '') + 'Z';
        
        if (suffix) {
            return `${zuluTimestamp}_${cleanFlightId}_${suffix}`;
        }
        return `${zuluTimestamp}_${cleanFlightId}`;
    }

    savePlanToJson() {
        const planData = {
            unit: this.stateManager.unit,
            fuelType: this.stateManager.fuelType,
            flightInfo: {},
            waypoints: this.stateManager.waypoints.map((wp) => ({
                lat: wp.marker.getLngLat().lat,
                lng: wp.marker.getLngLat().lng,
                name: wp.cachedName,
                legCustoms: wp.legCustoms
            }))
        };

        FLIGHT_PLAN_FIELDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                planData.flightInfo[id] = el.value;
            }
        });

        const modal = document.getElementById('save-file-modal');
        const input = document.getElementById('modal-filename-input');
        const btnCancel = document.getElementById('btn-modal-cancel');
        const btnConfirm = document.getElementById('btn-modal-confirm');

        document.getElementById('modal-title').innerText = "Save Flight Plan";
        document.getElementById('modal-desc').innerText = "Enter the name to export your JSON file:";
        document.getElementById('modal-extension').innerText = ".json";

        const defaultName = this.getAeronauticalBaseName('');
        input.value = defaultName;

        modal.showModal();

        btnCancel.onclick = () => modal.close();

        btnConfirm.onclick = () => {
            let fileName = input.value.trim();
            if (!fileName) {
                fileName = defaultName;
            }
            if (!fileName.endsWith('.json')) {
                fileName += '.json';
            }

            const jsonStr = JSON.stringify(planData, null, 2);
            this.executeDownload(fileName, jsonStr);
            modal.close();
        };
    }

    triggerPdfSaveFlow(type) {
        const modal = document.getElementById('save-file-modal');
        const input = document.getElementById('modal-filename-input');
        const btnCancel = document.getElementById('btn-modal-cancel');
        const btnConfirm = document.getElementById('btn-modal-confirm');

        let title = "Export Color PDF";
        if (type === 'mono') {
            title = "Export Monochrome PDF";
        }
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-desc').innerText = "Enter the name to save the print document:";
        document.getElementById('modal-extension').innerText = ".pdf";

        let suffix = '';
        if (type === 'mono') {
            suffix = 'PRINT';
        }

        const rawDateEl = document.getElementById('flight-date');
        let rawDate = '';
        if (rawDateEl) {
            rawDate = rawDateEl.value || '';
        }
        let datePart = 'NODATE';
        if (rawDate) {
            datePart = rawDate.replace(/-/g, '');
        }
        
        const depValEl = document.getElementById('airfield-dep');
        let depVal = '';
        if (depValEl) {
            depVal = depValEl.value || '';
        }
        let depPart = 'ZZZZ';
        if (depVal) {
            depPart = depVal.trim().toUpperCase();
        }
        
        const arrValEl = document.getElementById('airfield-arr');
        let arrVal = '';
        if (arrValEl) {
            arrVal = arrValEl.value || '';
        }
        let arrPart = 'ZZZZ';
        if (arrVal) {
            arrPart = arrVal.trim().toUpperCase();
        }
        
        const idValEl = document.getElementById('flight-id');
        let idVal = '';
        if (idValEl) {
            idVal = idValEl.value || '';
        }
        let idPart = 'FLIGHT';
        if (idVal) {
            idPart = idVal.trim().toUpperCase();
        }

        let suffixPart = '';
        if (suffix) {
            suffixPart = `_${suffix}`;
        }
        const defaultName = `${datePart}_${depPart}_${arrPart}_${idPart}${suffixPart}`;
        input.value = defaultName;

        modal.showModal();

        btnCancel.onclick = () => modal.close();

        btnConfirm.onclick = () => {
            let fileName = input.value.trim();
            if (!fileName) {
                fileName = defaultName;
            }
            if (!fileName.endsWith('.pdf')) {
                fileName += '.pdf';
            }

            const isMono = (type === 'mono');
            this.controller.pdfExporter.exportToPDFMap(isMono, fileName);

            modal.close();
        };
    }

    triggerKmlSaveFlow() {
        const modal = document.getElementById('save-file-modal');
        const input = document.getElementById('modal-filename-input');
        const btnCancel = document.getElementById('btn-modal-cancel');
        const btnConfirm = document.getElementById('btn-modal-confirm');

        document.getElementById('modal-title').innerText = "Export KML";
        document.getElementById('modal-desc').innerText = "Enter the name to save the KML file:";
        document.getElementById('modal-extension').innerText = ".kml";

        const defaultName = this.getAeronauticalBaseName('KML');
        input.value = defaultName;

        modal.showModal();

        btnCancel.onclick = () => modal.close();

        btnConfirm.onclick = () => {
            let fileName = input.value.trim();
            if (!fileName) {
                fileName = defaultName;
            }
            if (!fileName.toLowerCase().endsWith('.kml')) {
                fileName += '.kml';
            }

            console.log("✅ Starting KML download with name: ", fileName);
            this.kmlManager.exportToKml(fileName);

            modal.close();
        };
    }

    handleJsonFileLoad(file) {
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                this.stateManager.unit = data.unit || 'USG';
                this.stateManager.fuelType = data.fuelType || 'AVGAS100LL';

                const unitSelector = document.getElementById('unit-selector');
                const fuelSelector = document.getElementById('fuel-type-selector');

                if (unitSelector) {
                    unitSelector.value = this.stateManager.unit;
                }
                if (fuelSelector) {
                    fuelSelector.value = this.stateManager.fuelType;
                }

                this.stateManager.waypoints.forEach((wp) => {
                    if (wp.marker) {
                        wp.marker.remove();
                    }
                });
                this.stateManager.clearWaypoints();

                if (data.flightInfo) {
                    FLIGHT_PLAN_FIELDS.forEach((id) => {
                        const element = document.getElementById(id);
                        if (element && data.flightInfo[id] !== undefined) {
                            element.value = data.flightInfo[id];
                        }
                    });
                }

                if (data.waypoints) {
                    data.waypoints.forEach((wp) => {
                        this.controller.addWaypoint(wp.lng, wp.lat, wp.name, wp.legCustoms, false);
                    });
                }

                this.rebuildUI();
                this.refreshApp();

                if (this.stateManager.waypoints.length > 0 && this.map) {
                    const bounds = new maplibregl.LngLatBounds();
                    this.stateManager.waypoints.forEach((wp) => {
                        bounds.extend(wp.marker.getLngLat());
                    });
                    
                    this.map.fitBounds(bounds, { 
                        padding: 80,
                        maxZoom: 10,
                        duration: 1000
                    });
                }

            } catch (error) {
                console.error('Error loading JSON:', error);
                alert('Invalid JSON');
            }
        };
        reader.readAsText(file);
    }

    handleKmlFileLoad(file) {
        if (!file || !this.kmlManager) {
            return;
        }

        const MAX_SIZE_MB = 15;
        const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
        
        if (file.size > MAX_SIZE_BYTES) {
            alert('The file is too large (' + (file.size / 1024 / 1024).toFixed(1) + ' MB).\nThe limit is ' + MAX_SIZE_MB + ' MB to avoid freezing the browser.');
            const inputEl = document.getElementById('input-kml');
            if (inputEl) {
                inputEl.value = '';
            }
            return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                this.kmlManager.importKml(file.name || 'Imported KML', ev.target.result);
            } catch (error) {
                console.error(error);
                alert('Error reading KML file.');
            }
        };
        reader.readAsText(file, 'utf-8');
        
        const inputEl = document.getElementById('input-kml');
        if (inputEl) {
            inputEl.value = '';
        }
    }

    handleFuelConfigChange() {
        const newUnit = document.getElementById('unit-selector').value;
        const newType = document.getElementById('fuel-type-selector').value;

        const multiplier = FuelConverter.getMultiplier(
            this.stateManager.unit,
            this.stateManager.fuelType,
            newUnit,
            newType
        );

        const fuelInputs = [
            'global-ff', 'global-taxi-ff', 'global-ff-holding', 'global-ramp', 'global-taxi',
            'global-climb', 'global-desc', 'global-cont', 'global-altern', 'global-reser'
        ];

        fuelInputs.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                let baseValue = this.stateManager.getBaseFuelValue(id);
                
                if (baseValue === undefined) {
                    baseValue = parseFloat(el.value) || 0;
                    this.stateManager.updateBaseFuelValue(id, baseValue);
                }

                const newValue = baseValue * multiplier;
                
                if (el.value !== '') {
                    el.value = newValue.toFixed(1);
                }
                
                this.stateManager.updateBaseFuelValue(id, newValue);
            }
        });

        this.stateManager.waypoints.forEach((wp) => {
            if (wp.legCustoms && wp.legCustoms.ff !== undefined && wp.legCustoms.ff !== '') {
                const currentBase = parseFloat(wp.legCustoms.ff) || 0;
                const newValue = currentBase * multiplier;
                wp.legCustoms.ff = newValue.toFixed(1);
            }
        });

        this.stateManager.unit = newUnit;
        this.stateManager.fuelType = newType;

        const ffLabels = {
            'global-taxi-ff': 'TAXI',
            'global-ff': 'CRZ',
            'global-ff-holding': 'HOLD'
        };
        
        for (const [id, baseText] of Object.entries(ffLabels)) {
            const inputEl = document.getElementById(id);
            if (inputEl && inputEl.previousElementSibling) {
                inputEl.previousElementSibling.innerText = `${baseText} (${newUnit}/H)`;
            }
        }

        this.rebuildUI();
        this.refreshApp();
    }

    rebuildUI() {
        if (this.controller) {
            this.controller.rebuildUI();
        }
    }

    refreshApp() {
        if (this.controller) {
            this.controller.refreshApp();
        }
    } 

    initMobileTabs() {
        console.log('Initializing mobile tabs...');
        const container = document.getElementById('mobile-tabs');
        if (!container) {
            console.error('ERROR: #mobile-tabs not found in DOM. Check HTML.');
            return;
        }

        const buttons = container.querySelectorAll('.tab-btn');
        const panels = {
            left: document.querySelector('.panel-left'),
            map: document.querySelector('.panel-map'),
            right: document.querySelector('.panel-right')
        };

        const activate = (name) => {
            buttons.forEach((b) => {
                if (b.dataset.panel === name) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });
            Object.values(panels).forEach((p) => {
                if (p) {
                    p.classList.remove('active');
                }
            });
            if (panels[name]) {
                panels[name].classList.add('active');
            }
            
            if (name === 'map' && this.map) {
                setTimeout(() => {
                    this.map.resize();
                }, 100);
            }
            console.log('Active tab: ' + name);
        };

        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                activate(btn.dataset.panel);
            });
        });
        activate('left'); 
    }
}

// ============================================================================
//   13. MEASURE TOOL
// ============================================================================
class MeasureTool {
    constructor(mapInstance, geomagService) {
        this.map = mapInstance;
        this.geomagService = geomagService;
        this.isMeasuring = false;
        this.measurePoints = [];
        
        // DOM Elements
        this.btnMeasure = document.getElementById('btn-measure');
        this.measureOutput = document.getElementById('measure-output');
        this.measureBrgTrue = document.getElementById('measure-brg-true');
        this.measureBrgMag = document.getElementById('measure-brg-mag');
        this.measureDist = document.getElementById('measure-dist');

        // Bindings to not lose the 'this' context
        this.handleMeasureClick = this.handleMeasureClick.bind(this);
        this.handleMeasureMouseMove = this.handleMeasureMouseMove.bind(this);

        this._initEvents();
    }

    _initEvents() {
        if (this.btnMeasure) {
            this.btnMeasure.addEventListener('click', () => {
                this.toggleMeasureMode();
            });
        }
    }

    toggleMeasureMode() {
        this.isMeasuring = !this.isMeasuring;
        this.measurePoints = [];
        this.clearMeasureRender();

        if (this.isMeasuring) {
            this.btnMeasure.classList.add('active');
            this.measureOutput.classList.remove('hidden');
            
            // Reset UI
            this._updateUI('---', '---', '-.-');
            
            this.map.getCanvas().style.cursor = 'crosshair';
            this.map.on('click', this.handleMeasureClick);
            this.map.on('mousemove', this.handleMeasureMouseMove);
        } else {
            this.btnMeasure.classList.remove('active');
            this.measureOutput.classList.add('hidden');
            this.map.getCanvas().style.cursor = '';
            this.map.off('click', this.handleMeasureClick);
            this.map.off('mousemove', this.handleMeasureMouseMove);
        }
    }

    handleMeasureClick(e) {
        const coords = [e.lngLat.lng, e.lngLat.lat];
        
        // Restart if we already have 2 points
        if (this.measurePoints.length >= 2) {
            this.measurePoints = [coords];
        } else {
            this.measurePoints.push(coords);
        }

        this.updateMeasureRender(coords);
    }

    handleMeasureMouseMove(e) {
        if (this.measurePoints.length === 0) {
            return;
        }
        
        const currentCoords = [e.lngLat.lng, e.lngLat.lat];
        const startCoords = this.measurePoints[0];

        const startPoint = turf.point(startCoords);
        const endPoint = turf.point(currentCoords);

        // Calculations
        let trueBearing = (turf.bearing(startPoint, endPoint) + 360) % 360; 
        const altEl = document.getElementById('global-alt');
        let alt = 9500;
        if (altEl) {
            alt = parseFloat(altEl.value) || 9500;
        }
        const magVar = this.geomagService.getVariation(startCoords[1], startCoords[0], alt);
        let magBearing = (trueBearing - magVar + 360) % 360;
        const distance = turf.distance(startPoint, endPoint, { units: 'nauticalmiles' });

        // Freeze values when fixing the second point
        if (this.measurePoints.length === 1) {
            this._updateUI(
                Math.round(trueBearing).toString().padStart(3, '0'),
                Math.round(magBearing).toString().padStart(3, '0'), 
                distance.toFixed(1)
            );
            this.updateMeasureRender(currentCoords);
        }
    }

    _updateUI(tru, mag, dst) {
        if (this.measureBrgTrue) {
            this.measureBrgTrue.textContent = tru;
        }
        if (this.measureBrgMag) {
            this.measureBrgMag.textContent = mag;
        }
        if (this.measureDist) {
            this.measureDist.textContent = dst;
        }
    }

    updateMeasureRender(previewCoords) {
        const features = this.measurePoints.map((pt) => {
            return turf.point(pt);
        });

        if (this.measurePoints.length === 1 && previewCoords) {
            features.push(turf.greatCircle(turf.point(this.measurePoints[0]), turf.point(previewCoords), { npoints: 100 }));
        } else if (this.measurePoints.length === 2) {
            features.push(turf.greatCircle(turf.point(this.measurePoints[0]), turf.point(this.measurePoints[1]), { npoints: 100 }));
        }

        const source = this.map.getSource('measure-geo');
        if (source) {
            source.setData(turf.featureCollection(features));
        }
    }

    clearMeasureRender() {
        const source = this.map.getSource('measure-geo');
        if (source) {
            source.setData(turf.featureCollection([]));
        }
    }
}

// ============================================================================
//   INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    window.app = new FlightPlanner();
});