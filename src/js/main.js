/**
 * main.js — Fleet Performance Dashboard MyGeotab Add-in.
 * Factory: geotab.addin.fleetPerformance
 */
geotab.addin.fleetPerformance = function () {
    "use strict";

    var api, state;
    var currentData = null;       // last loaded { byDevice, fleet }
    var currentFromDate = null;
    var currentToDate = null;
    var sortKey = "mpg";
    var sortDir = -1;             // -1 = desc
    var searchFilter = "";
    var drillDeviceId = null;

    // ── DOM refs (assigned in initialize) ───────────────────────────
    var el = {};

    // ── Lifecycle ────────────────────────────────────────────────────

    return {
        initialize: function (freshApi, freshState, callback) {
            api = freshApi;
            state = freshState;
            cacheEls();
            bindEvents();
            setDefaultDates(30);
            showView("fleet");

            FPD.DeviceCache.load(api).then(function () {
                populateGroupDropdown();
                callback();
            }).catch(function (err) {
                showError("Failed to load device data: " + err);
                callback();
            });
        },

        focus: function () {
            if (!currentData) applyFilters();
        },

        blur: function () {}
    };

    // ── DOM helpers ──────────────────────────────────────────────────

    function cacheEls() {
        var ids = [
            "fpdFleetView", "fpdDrillView",
            "fpdGroupSelect", "fpdSearchInput",
            "fpdFromDate", "fpdToDate",
            "fpdApplyBtn",
            "fpdKpiMPG", "fpdKpiHours", "fpdKpiIdle", "fpdKpiCount",
            "fpdTrendCanvas",
            "fpdTableBody",
            "fpdExportBtn",
            "fpdLoading", "fpdError", "fpdErrorMsg",
            "fpdDrillTitle", "fpdDrillMPG", "fpdDrillHours", "fpdDrillIdle",
            "fpdDrillCanvas", "fpdDrillIdleList", "fpdDrillBackBtn"
        ];
        ids.forEach(function (id) { el[id] = document.getElementById(id); });
    }

    function bindEvents() {
        el.fpdApplyBtn.addEventListener("click", applyFilters);

        // Preset date buttons
        document.querySelectorAll("[data-fpd-days]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.querySelectorAll("[data-fpd-days]").forEach(function (b) { b.classList.remove("fpd-preset-active"); });
                btn.classList.add("fpd-preset-active");
                setDefaultDates(parseInt(btn.getAttribute("data-fpd-days"), 10));
            });
        });

        el.fpdSearchInput.addEventListener("input", function () {
            searchFilter = el.fpdSearchInput.value.toLowerCase();
            if (currentData) renderTable();
        });

        el.fpdExportBtn.addEventListener("click", exportCSV);
        el.fpdDrillBackBtn.addEventListener("click", function () { showView("fleet"); });

        // Sortable column headers
        document.querySelectorAll("[data-fpd-sort]").forEach(function (th) {
            th.addEventListener("click", function () {
                var key = th.getAttribute("data-fpd-sort");
                if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = -1; }
                updateSortHeaders();
                if (currentData) renderTable();
            });
        });
    }

    function setDefaultDates(days) {
        var to = new Date();
        var from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        el.fpdFromDate.value = dateToInput(from);
        el.fpdToDate.value = dateToInput(to);
    }

    function populateGroupDropdown() {
        var groups = FPD.DeviceCache.getAllGroups()
            .filter(function (g) { return g.name && g.name !== ""; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); });

        el.fpdGroupSelect.innerHTML = '<option value="">All Vehicles</option>';
        groups.forEach(function (g) {
            var opt = document.createElement("option");
            opt.value = g.id;
            opt.textContent = g.name;
            el.fpdGroupSelect.appendChild(opt);
        });
    }

    // ── Data Loading ─────────────────────────────────────────────────

    function applyFilters() {
        var fromDate = new Date(el.fpdFromDate.value);
        var toDate = new Date(el.fpdToDate.value);
        toDate.setHours(23, 59, 59, 999);

        if (isNaN(fromDate) || isNaN(toDate) || fromDate >= toDate) {
            showError("Please select a valid date range.");
            return;
        }

        currentFromDate = fromDate;
        currentToDate = toDate;

        var groupId = el.fpdGroupSelect.value;
        var searchText = el.fpdSearchInput.value.toLowerCase();

        // If user typed a search, find matching device IDs
        var deviceIds = null;
        if (searchText.length > 1) {
            deviceIds = FPD.DeviceCache.getDevicesInGroup(groupId)
                .filter(function (d) {
                    return (d.name || "").toLowerCase().indexOf(searchText) >= 0 ||
                           (d.serialNumber || "").toLowerCase().indexOf(searchText) >= 0;
                })
                .map(function (d) { return d.id; });
            if (deviceIds.length === 0) {
                showError("No trucks match your search.");
                return;
            }
        }

        showLoading(true);
        hideError();

        FPD.DataService.loadFleetData(api, {
            groupId: groupId,
            deviceIds: deviceIds,
            fromDate: fromDate,
            toDate: toDate
        }, function (err, data) {
            showLoading(false);
            if (err) { showError("Failed to load data: " + (err.message || err)); return; }
            currentData = data;
            renderDashboard();
        });
    }

    // ── Rendering ─────────────────────────────────────────────────────

    function renderDashboard() {
        renderKPIs();
        renderTrendChart();
        renderTable();
    }

    function renderKPIs() {
        var f = currentData.fleet;
        el.fpdKpiMPG.textContent = f.avgMPG > 0 ? f.avgMPG.toFixed(2) : "--";
        el.fpdKpiHours.textContent = f.totalEngineHours > 0 ? Math.round(f.totalEngineHours).toLocaleString() : "--";

        var idlePct = f.avgIdlePct;
        el.fpdKpiIdle.textContent = idlePct > 0 ? idlePct.toFixed(1) + "%" : "--";
        el.fpdKpiIdle.parentElement.classList.toggle("fpd-kpi-warn", idlePct > FPD.Constants.IDLE_TARGET_PCT);

        el.fpdKpiCount.textContent = f.deviceCount.toLocaleString();
    }

    function renderTrendChart() {
        if (!el.fpdTrendCanvas || !currentData) return;
        // Build fleet-level daily MPG using all FuelUsed — simplified: aggregate from byDevice
        // For trend chart we need raw records; use a separate daily call isn't done here.
        // Instead render a bar of per-device MPG distribution for quick overview.
        var devices = getFilteredDevices();
        var mpgValues = devices
            .filter(function (d) { return d.mpg > 0; })
            .map(function (d) { return { label: (FPD.DeviceCache.getDevice(d.deviceId) || {}).name || d.deviceId, value: d.mpg }; })
            .sort(function (a, b) { return b.value - a.value; })
            .slice(0, 20);

        FPD.Charts.drawLineChart(el.fpdTrendCanvas, mpgValues, {
            title: "MPG by Truck (top 20)",
            color: "#1976d2",
            targetLine: currentData.fleet.avgMPG,
            yLabel: "MPG"
        });
    }

    function renderTable() {
        if (!currentData || !el.fpdTableBody) return;
        var devices = getFilteredDevices();

        // Sort
        devices.sort(function (a, b) {
            var av = a[sortKey] || 0, bv = b[sortKey] || 0;
            return sortDir * (bv - av);
        });

        if (devices.length === 0) {
            el.fpdTableBody.innerHTML = '<tr><td colspan="8" class="fpd-empty">No trucks found for this period.</td></tr>';
            return;
        }

        el.fpdTableBody.innerHTML = devices.map(function (d) {
            var dev = FPD.DeviceCache.getDevice(d.deviceId) || {};
            var name = dev.name || d.deviceId;
            var idleClass = d.idlePct > FPD.Constants.IDLE_TARGET_PCT ? " fpd-warn" : "";
            return '<tr class="fpd-row" data-device-id="' + d.deviceId + '">' +
                '<td>' + esc(name) + '</td>' +
                '<td>' + fmt(d.miles, 0) + '</td>' +
                '<td>' + fmt(d.fuelGallons, 1) + '</td>' +
                '<td><strong>' + (d.mpg > 0 ? d.mpg.toFixed(2) : "--") + '</strong></td>' +
                '<td>' + (d.engineHours > 0 ? Math.round(d.engineHours).toLocaleString() : "--") + '</td>' +
                '<td class="' + idleClass + '">' + (d.idlePct > 0 ? d.idlePct.toFixed(1) + "%" : "--") + '</td>' +
                '<td>' + fmt(d.idleGallons, 1) + '</td>' +
                '<td><button class="fpd-drill-btn" data-device-id="' + d.deviceId + '">Details</button></td>' +
                '</tr>';
        }).join("");

        // Bind drill-down buttons
        el.fpdTableBody.querySelectorAll(".fpd-drill-btn").forEach(function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                openDrillDown(btn.getAttribute("data-device-id"));
            });
        });
    }

    function getFilteredDevices() {
        if (!currentData) return [];
        return Object.values(currentData.byDevice).filter(function (d) {
            if (!searchFilter) return true;
            var dev = FPD.DeviceCache.getDevice(d.deviceId) || {};
            return (dev.name || "").toLowerCase().indexOf(searchFilter) >= 0 ||
                   (dev.serialNumber || "").toLowerCase().indexOf(searchFilter) >= 0;
        });
    }

    // ── Drill-Down ───────────────────────────────────────────────────

    function openDrillDown(deviceId) {
        var dev = FPD.DeviceCache.getDevice(deviceId) || {};
        var d = currentData.byDevice[deviceId];
        drillDeviceId = deviceId;

        el.fpdDrillTitle.textContent = dev.name || deviceId;
        el.fpdDrillMPG.textContent = d && d.mpg > 0 ? d.mpg.toFixed(2) + " MPG" : "-- MPG";
        el.fpdDrillHours.textContent = d && d.engineHours > 0 ? Math.round(d.engineHours).toLocaleString() + " hrs" : "-- hrs";
        el.fpdDrillIdle.textContent = d && d.idlePct > 0 ? d.idlePct.toFixed(1) + "% idle" : "-- idle";

        showView("drill");

        // Load daily breakdown for this device
        FPD.DataService.loadDeviceDaily(api, deviceId, currentFromDate, currentToDate, function (err, data) {
            if (err || !data) return;
            var points = FPD.Charts.buildDailyMPGPoints(data.fuelRecords, currentFromDate, currentToDate);
            FPD.Charts.drawLineChart(el.fpdDrillCanvas, points, {
                title: "Daily MPG — " + (dev.name || deviceId),
                color: "#1976d2",
                yLabel: "MPG"
            });
            renderIdleList(data.idleEvents);
        });
    }

    function renderIdleList(events) {
        if (!el.fpdDrillIdleList) return;
        if (!events || events.length === 0) {
            el.fpdDrillIdleList.innerHTML = "<li>No idling events in this period.</li>";
            return;
        }
        var sorted = events.slice().sort(function (a, b) {
            return new Date(b.activeFrom) - new Date(a.activeFrom);
        }).slice(0, 20);

        el.fpdDrillIdleList.innerHTML = sorted.map(function (e) {
            var dur = e.activeFrom && e.activeTo
                ? Math.round((new Date(e.activeTo) - new Date(e.activeFrom)) / 1000 / 60)
                : 0;
            var dt = e.activeFrom ? new Date(e.activeFrom).toLocaleDateString() : "";
            return "<li>" + esc(dt) + " &mdash; " + dur + " min</li>";
        }).join("");
    }

    // ── Export ───────────────────────────────────────────────────────

    function exportCSV() {
        if (!currentData) return;
        var rows = [["Truck", "Miles", "Fuel (gal)", "MPG", "Engine Hours", "Idle %", "Idle Fuel (gal)"]];
        getFilteredDevices().forEach(function (d) {
            var dev = FPD.DeviceCache.getDevice(d.deviceId) || {};
            rows.push([
                dev.name || d.deviceId,
                d.miles.toFixed(1),
                d.fuelGallons.toFixed(1),
                d.mpg > 0 ? d.mpg.toFixed(2) : "",
                d.engineHours > 0 ? Math.round(d.engineHours) : "",
                d.idlePct > 0 ? d.idlePct.toFixed(1) : "",
                d.idleGallons.toFixed(1)
            ]);
        });
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
        var blob = new Blob([csv], { type: "text/csv" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "fleet-performance-" + dateToInput(new Date()) + ".csv";
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── UI Helpers ───────────────────────────────────────────────────

    function showView(view) {
        el.fpdFleetView.style.display = view === "fleet" ? "" : "none";
        el.fpdDrillView.style.display = view === "drill" ? "" : "none";
    }

    function showLoading(show) {
        if (el.fpdLoading) el.fpdLoading.style.display = show ? "" : "none";
    }

    function showError(msg) {
        if (el.fpdError) el.fpdError.style.display = "";
        if (el.fpdErrorMsg) el.fpdErrorMsg.textContent = msg;
    }

    function hideError() {
        if (el.fpdError) el.fpdError.style.display = "none";
    }

    function updateSortHeaders() {
        document.querySelectorAll("[data-fpd-sort]").forEach(function (th) {
            th.classList.remove("fpd-sort-asc", "fpd-sort-desc");
            if (th.getAttribute("data-fpd-sort") === sortKey) {
                th.classList.add(sortDir > 0 ? "fpd-sort-asc" : "fpd-sort-desc");
            }
        });
    }

    function dateToInput(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function fmt(v, dec) { return v > 0 ? v.toFixed(dec).toLocaleString() : "--"; }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
};
