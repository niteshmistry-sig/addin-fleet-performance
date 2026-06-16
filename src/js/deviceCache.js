/**
 * deviceCache.js — Caches Device + Group data via multiCall at startup.
 * Provides O(1) lookups by device ID.
 */
var FPD = FPD || {};

FPD.DeviceCache = (function () {
    "use strict";

    var _devices = {};   // id → device object
    var _groups = {};    // id → group object
    var _loaded = false;

    function load(api) {
        return new Promise(function (resolve, reject) {
            api.multiCall([
                ["Get", { typeName: "Device", resultsLimit: 50000 }],
                ["Get", { typeName: "Group", resultsLimit: 10000 }]
            ], function (results) {
                var deviceList = results[0];
                var groupList = results[1];

                _devices = {};
                deviceList.forEach(function (d) { _devices[d.id] = d; });

                _groups = {};
                groupList.forEach(function (g) { _groups[g.id] = g; });

                _loaded = true;
                resolve();
            }, function (err) {
                reject(err);
            });
        });
    }

    function getDevice(id) { return _devices[id] || null; }

    function getAllDevices() {
        return Object.keys(_devices).map(function (id) { return _devices[id]; });
    }

    function getAllGroups() {
        return Object.keys(_groups).map(function (id) { return _groups[id]; });
    }

    function getGroupName(id) {
        var g = _groups[id];
        return g ? (g.name || id) : id;
    }

    // Returns devices whose groups array includes the given groupId (recursive via group children)
    function getDevicesInGroup(groupId) {
        if (!groupId || groupId === FPD.Constants.GROUP_COMPANY_ID) {
            return getAllDevices();
        }
        // Collect all descendant group IDs
        var groupIds = {};
        function collectDescendants(gid) {
            groupIds[gid] = true;
            var g = _groups[gid];
            if (g && g.children) {
                g.children.forEach(function (child) { collectDescendants(child.id); });
            }
        }
        collectDescendants(groupId);

        return getAllDevices().filter(function (d) {
            return d.groups && d.groups.some(function (gr) { return groupIds[gr.id]; });
        });
    }

    function isLoaded() { return _loaded; }

    return { load, getDevice, getAllDevices, getAllGroups, getGroupName, getDevicesInGroup, isLoaded };
})();
