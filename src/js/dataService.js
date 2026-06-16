/**
 * dataService.js — API calls for Fleet Performance Dashboard.
 * Fetches FuelUsed, Engine Hours (StatusData), and Idling (ExceptionEvent).
 */
var FPD = FPD || {};

FPD.DataService = (function () {
    "use strict";

    var C = FPD.Constants;

    /**
     * Load fleet performance data for the given filters.
     * @param {Object} api - MyGeotab API object
     * @param {Object} options - { groupId, deviceIds, fromDate, toDate }
     * @param {Function} callback - function(err, data) where data = { byDevice, fleet }
     */
    function loadFleetData(api, options, callback) {
        var fromDate = options.fromDate.toISOString();
        var toDate = options.toDate.toISOString();

        // Build device search — either specific IDs or a group
        var deviceSearch = {};
        if (options.deviceIds && options.deviceIds.length > 0) {
            deviceSearch.ids = options.deviceIds;
        } else if (options.groupId && options.groupId !== C.GROUP_COMPANY_ID) {
            deviceSearch.groups = [{ id: options.groupId }];
        }

        var fuelSearch = { fromDate: fromDate, toDate: toDate };
        var ehSearch = {
            diagnosticSearch: { id: C.DIAGNOSTIC_ENGINE_HOURS },
            fromDate: fromDate,
            toDate: toDate
        };
        var idleSearch = {
            ruleSearch: { name: "Idling" },
            fromDate: fromDate,
            toDate: toDate
        };

        if (Object.keys(deviceSearch).length > 0) {
            fuelSearch.deviceSearch = deviceSearch;
            ehSearch.deviceSearch = deviceSearch;
            idleSearch.deviceSearch = deviceSearch;
        }

        api.multiCall([
            ["Get", { typeName: "FuelUsed", search: fuelSearch, resultsLimit: C.RESULTS_LIMIT }],
            ["Get", { typeName: "StatusData", search: ehSearch, resultsLimit: C.RESULTS_LIMIT }],
            ["Get", { typeName: "ExceptionEvent", search: idleSearch, resultsLimit: C.RESULTS_LIMIT }]
        ], function (results) {
            try {
                var data = processResults(results[0], results[1], results[2]);
                callback(null, data);
            } catch (e) {
                callback(e, null);
            }
        }, function (err) {
            callback(err, null);
        });
    }

    /**
     * Load daily breakdown for a single device (for drill-down chart).
     */
    function loadDeviceDaily(api, deviceId, fromDate, toDate, callback) {
        var search = {
            deviceSearch: { id: deviceId },
            fromDate: fromDate.toISOString(),
            toDate: toDate.toISOString()
        };

        api.multiCall([
            ["Get", { typeName: "FuelUsed", search: search, resultsLimit: C.RESULTS_LIMIT }],
            ["Get", { typeName: "ExceptionEvent", search: Object.assign({}, search, { ruleSearch: { name: "Idling" } }), resultsLimit: C.RESULTS_LIMIT }]
        ], function (results) {
            callback(null, { fuelRecords: results[0], idleEvents: results[1] });
        }, function (err) {
            callback(err, null);
        });
    }

    // ── Data Processing ─────────────────────────────────────────────

    function processResults(fuelRecords, ehRecords, idleEvents) {
        var byDevice = {};

        // Process FuelUsed records → group by device
        fuelRecords.forEach(function (r) {
            var id = r.device && r.device.id;
            if (!id) return;
            if (!byDevice[id]) byDevice[id] = emptyDeviceRecord(id);
            var d = byDevice[id];
            d.fuelLiters += (r.volume || 0);
            d.idleLiters += (r.idlingVolume || 0);
            // FuelUsed.distance is in metres
            d.distanceKm += ((r.distance || 0) / 1000);
        });

        // Process StatusData (engine hours) → first + last reading per device
        var ehByDevice = {};
        ehRecords.forEach(function (r) {
            var id = r.device && r.device.id;
            if (!id) return;
            if (!ehByDevice[id]) ehByDevice[id] = { first: null, last: null };
            var dt = new Date(r.dateTime).getTime();
            var entry = ehByDevice[id];
            if (!entry.first || dt < entry.first.t) entry.first = { t: dt, v: r.data };
            if (!entry.last || dt > entry.last.t) entry.last = { t: dt, v: r.data };
        });

        Object.keys(ehByDevice).forEach(function (id) {
            if (!byDevice[id]) byDevice[id] = emptyDeviceRecord(id);
            var entry = ehByDevice[id];
            if (entry.first && entry.last) {
                // Engine hours are stored as seconds in StatusData.data
                byDevice[id].engineHours = (entry.last.v - entry.first.v) / 3600;
            }
        });

        // Process ExceptionEvent (idling) → total duration per device
        idleEvents.forEach(function (e) {
            var id = e.device && e.device.id;
            if (!id) return;
            if (!byDevice[id]) byDevice[id] = emptyDeviceRecord(id);
            var dur = 0;
            if (e.activeFrom && e.activeTo) {
                dur = (new Date(e.activeTo) - new Date(e.activeFrom)) / 1000 / 60; // minutes
            }
            byDevice[id].idleEventCount += 1;
            byDevice[id].idleMinutes += dur;
        });

        // Compute derived metrics
        var totalMPG = 0, totalIdlePct = 0, totalEngHrs = 0, validMPG = 0;
        Object.keys(byDevice).forEach(function (id) {
            var d = byDevice[id];
            var gallons = d.fuelLiters / C.LITERS_PER_GALLON;
            var miles = d.distanceKm / C.KM_PER_MILE;
            d.fuelGallons = gallons;
            d.miles = miles;
            d.mpg = (gallons > 0.5 && miles > 1) ? miles / gallons : 0;
            d.idlePct = (d.fuelLiters > 0) ? (d.idleLiters / d.fuelLiters) * 100 : 0;
            d.idleGallons = d.idleLiters / C.LITERS_PER_GALLON;
            if (d.mpg > 0) { totalMPG += d.mpg; validMPG++; }
            totalIdlePct += d.idlePct;
            totalEngHrs += d.engineHours;
        });

        var count = Object.keys(byDevice).length || 1;
        var fleet = {
            avgMPG: validMPG > 0 ? totalMPG / validMPG : 0,
            avgIdlePct: totalIdlePct / count,
            totalEngineHours: totalEngHrs,
            deviceCount: count
        };

        return { byDevice: byDevice, fleet: fleet };
    }

    function emptyDeviceRecord(id) {
        return {
            deviceId: id,
            fuelLiters: 0, idleLiters: 0, distanceKm: 0,
            engineHours: 0, idleEventCount: 0, idleMinutes: 0,
            // computed later:
            fuelGallons: 0, miles: 0, mpg: 0, idlePct: 0, idleGallons: 0
        };
    }

    return { loadFleetData, loadDeviceDaily };
})();
