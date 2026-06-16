/**
 * main.js — Fleet Performance Dashboard MyGeotab Add-in.
 * Factory: geotab.addin.fleetPerformance
 */
geotab.addin.fleetPerformance = function () {
    "use strict";

    var api, state;
    var currentData = null;
    var currentFromDate = null;
    var currentToDate = null;
    var sortKey = "mpg";
    var sortDir = -1;
    var tableSearchFilter = "";
    var activeTab = "trend";
    var chartTopN = 20;
    var activeDays = 7;

    var el = {};

    // ── Lifecycle ────────────────────────────────────────────────────

    return {
        initialize: function (freshApi, freshState, callback) {
            api = freshApi;
            state = freshState;
            cacheEls();
            bindEvents();
            setDatesFromDays(7);
            showView("fleet");

            FPD.DeviceCache.load(api).then(function () {
                populateGroupDropdown();
                callback();
            }).catch(function (err) {
                showError("Failed to load device data: " + (err.message || err));
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
            "fpdFromDate", "fpdToDate", "fpdCustomRange",
            "fpdApplyBtn",
            "fpdKpiMPG", "fpdKpiHours", "fpdKpiIdle", "fpdKpiIdleCard", "fpdKpiCount",
            "fpdTrendCanvas",
            "fpdPanelTrend", "fpdPanelTable",
            "fpdBestBody", "fpdIdleBody", "fpdHoursBody",
            "fpdTableBody", "fpdTableSearch",
            "fpdExportBtn",
            "fpdLoading", "fpdError", "fpdErrorMsg",
            "fpdDrillTitle", "fpdDrillMPG", "fpdDrillHours",
            "fpdDrillIdle", "fpdDrillMiles",
            "fpdDrillCanvas", "fpdDrillIdleList", "fpdDrillBackBtn"
        ];
        ids.forEach(function (id) { el[id] = document.getElementById(id); });
    }

    function bindEvents() {
        // Apply
        el.fpdApplyBtn.addEventListener("click", applyFilters);

        // Preset date buttons
        document.querySelectorAll("[data-fpd-days]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.querySelectorAll("[data-fpd-days]").forEach(function (b) {
                    b.classList.remove("fpd-preset-active");
                });
                btn.classList.add("fpd-preset-active");
                var days = parseInt(btn.getAttribute("data-fpd-days"), 10);
                activeDays = days;
                if (days > 0) {
                    setDatesFromDays(days);
                }
            });
        });

        // Tab navigation
        document.querySelectorAll("[data-fpd-tab]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.querySelectorAll("[data-fpd-tab]").forEach(function (b) {
                    b.classList.remove("fpd-tab-active");
                });
                btn.classList.add("fpd-tab-active");
                activeTab = btn.getAttribute("data-fpd-tab");
                el.fpdPanelTrend.style.display = activeTab === "trend" ? "" : "none";
                el.fpdPanelTable.style.display = activeTab === "table" ? "" : "none";
                if (currentData) {
                    if (activeTab === "trend") renderTrendChart();
                    else renderTable();
                }
            });
        });

        // Chart top-N toggle
        document.querySelectorAll("[data-fpd-group]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.querySelectorAll("[data-fpd-group]").forEach(function (b) {
                    b.classList.remove("fpd-toggle-active");
                });
                btn.classList.add("fpd-toggle-active");
                chartTopN = parseInt(btn.getAttribute("data-fpd-group"), 10);
                if (currentData) renderTrendChart();
            });
        });

        // Table search
        el.fpdTableSearch.addEventListener("input", function () {
            tableSearchFilter = el.fpdTableSearch.value.toLowerCase();
            if (currentData) renderTable();
        });

        // Vehicle filter search (also filters table when applied)
        el.fpdSearchInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") applyFilters();
        });

        // Export
        el.fpdExportBtn.addEventListener("click", exportCSV);

        // Back button
        el.fpdDrillBackBtn.addEventListener("click", function () { showView("fleet"); });

        // Sortable headers
        document.querySelectorAll("[data-fpd-sort]").forEach(function (th) {
            th.addEventListener("click", function () {
                var key = th.getAttribute("data-fpd-sort");
                if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = -1; }
                updateSortHeaders();
                if (currentData) renderTable();
            });
        });
    }

    function setDatesFromDays(days) {
        var to = new Date();
        var from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        if (el.fpdFromDate) el.fpdFromDate.value = dateToInput(from);
        if (el.fpdToDate) el.fpdToDate.value = dateToInput(to);
    }

    function populateGroupDropdown() {
        var groups = FPD.DeviceCache.getAllGroups()
            .filter(function (g) { return g.name && g.name.trim() !== ""; })
            .sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });

        el.fpdGroupSelect.innerHTML = '<option value="">All Groups</option>';
        groups.forEach(function (g) {
            var opt = document.createElement("option");
            opt.value = g.id;
            opt.textContent = g.name;
            el.fpdGroupSelect.appendChild(opt);
        });
    }

    // ── Data Loading ─────────────────────────────────────────────────

    function applyFilters() {
        var fromDate, toDate;

        if (activeDays > 0) {
            toDate = new Date();
            fromDate = new Date(toDate.getTime() - activeDays * 24 * 60 * 60 * 1000);
        } else {
            fromDate = new Date(el.fpdFromDate.value);
            toDate = new Date(el.fpdToDate.value);
            toDate.setHours(23, 59, 59, 999);
        }

        if (isNaN(fromDate) || isNaN(toDate) || fromDate >= toDate) {
            showError("Please select a valid date range.");
            return;
        }

        currentFromDate = fromDate;
        currentToDate = toDate;
        var groupId = el.fpdGroupSelect.value;
        var search = el.fpdSearchInput.value.toLowerCase();

        var deviceIds = null;
        if (search.length > 1) {
            deviceIds = FPD.DeviceCache.getDevicesInGroup(groupId)
                .filter(function (d) {
                    return (d.name || "").toLowerCase().indexOf(search) >= 0 ||
                           (d.serialNumber || "").toLowerCase().indexOf(search) >= 0;
                })
                .map(function (d) { return d.id; });
            if (deviceIds.length === 0) {
                showError("No units match your search.");
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
        renderSummaryTables();
        renderTable();
    }

    function renderKPIs() {
        var f = currentData.fleet;
        el.fpdKpiMPG.textContent = f.avgMPG > 0 ? f.avgMPG.toFixed(2) : "--";
        el.fpdKpiHours.textContent = f.totalEngineHours > 0
            ? Math.round(f.totalEngineHours).toLocaleString() : "--";

        var idlePct = f.avgIdlePct;
        el.fpdKpiIdle.textContent = idlePct > 0 ? idlePct.toFixed(1) + "%" : "--";
        var idleCard = el.fpdKpiIdleCard;
        if (idleCard) {
            idleCard.classList.toggle("fpd-kpi-warn", idlePct > FPD.Constants.IDLE_TARGET_PCT);
        }
        el.fpdKpiCount.textContent = f.deviceCount.toLocaleString();
    }

    function renderTrendChart() {
        if (!el.fpdTrendCanvas || !currentData) return;
        var devices = Object.values(currentData.byDevice)
            .filter(function (d) { return d.mpg > 0; })
            .sort(function (a, b) { return b.mpg - a.mpg; });

        var limit = chartTopN > 0 ? chartTopN : devices.length;
        var points = devices.slice(0, limit).map(function (d) {
            var dev = FPD.DeviceCache.getDevice(d.deviceId) || {};
            return { label: dev.name || d.deviceId, value: d.mpg };
        });

        FPD.Charts.drawLineChart(el.fpdTrendCanvas, points, {
            title: "",
            color: "#0077c8",
            targetLine: currentData.fleet.avgMPG,
            yLabel: "MPG"
        });
    }

    function renderSummaryTables() {
        var devices = Object.values(currentData.byDevice);

        // Best MPG (top 5)
        var bestMPG = devices.filter(function (d) { return d.mpg > 0; })
            .sort(function (a, b) { return b.mpg - a.mpg; }).slice(0, 5);
        el.fpdBestBody.innerHTML = bestMPG.length > 0 ? bestMPG.map(function (d) {
            var name = (FPD.DeviceCache.getDevice(d.deviceId) || {}).name || d.deviceId;
            return '<tr><td class="fpd-name-cell" data-device-id="' + d.deviceId + '">' + esc(name) + '</td>' +
                   '<td><strong>' + d.mpg.toFixed(2) + '</strong></td>' +
                   '<td>' + Math.round(d.miles).toLocaleString() + '</td></tr>';
        }).join("") : '<tr class="fpd-empty-row"><td colspan="3">No data</td></tr>';

        // Highest Idle % (top 5 with data)
        var highIdle = devices.filter(function (d) { return d.idlePct > 0; })
            .sort(function (a, b) { return b.idlePct - a.idlePct; }).slice(0, 5);
        el.fpdIdleBody.innerHTML = highIdle.length > 0 ? highIdle.map(function (d) {
            var name = (FPD.DeviceCache.getDevice(d.deviceId) || {}).name || d.deviceId;
            var cls = d.idlePct > FPD.Constants.IDLE_TARGET_PCT ? "fpd-badge fpd-badge-bad" : "";
            return '<tr><td class="fpd-name-cell" data-device-id="' + d.deviceId + '">' + esc(name) + '</td>' +
                   '<td><span class="' + cls + '">' + d.idlePct.toFixed(1) + '%</span></td>' +
                   '<td>' + d.idleGallons.toFixed(1) + '</td></tr>';
        }).join("") : '<tr class="fpd-empty-row"><td colspan="3">No data</td></tr>';

        // Most Engine Hours (top 5)
        var topHours = devices.filter(function (d) { return d.engineHours > 0; })
            .sort(function (a, b) { return b.engineHours - a.engineHours; }).slice(0, 5);
        el.fpdHoursBody.innerHTML = topHours.length > 0 ? topHours.map(function (d) {
            var name = (FPD.DeviceCache.getDevice(d.deviceId) || {}).name || d.deviceId;
            return '<tr><td class="fpd-name-cell" data-device-id="' + d.deviceId + '">' + esc(name) + '</td>' +
                   '<td><strong>' + Math.round(d.engineHours).toLocaleString() + '</strong></td>' +
                   '<td>' + Math.round(d.miles).toLocaleString() + '</td></tr>';
        }).join("") : '<tr class="fpd-empty-row"><td colspan="3">No data</td></tr>';

        // Bind name clicks to drill-down
        document.querySelectorAll(".fpd-name-cell[data-device-id]").forEach(function (cell) {
            cell.addEventListener("click", function () {
                openDrillDown(cell.getAttribute("data-device-id"));
            });
        });
    }

    function renderTable() {
        if (!currentData || !el.fpdTableBody) return;
        var filter = tableSearchFilter;
        var devices = Object.values(currentData.byDevice).filter(function (d) {
            if (!filter) return true;
            var dev = FPD.DeviceCache.getDevice(d.deviceId) || {};
            return (dev.name || "").toLowerCase().indexOf(filter) >= 0 ||
                   (dev.serialNumber || "").toLowerCase().indexOf(filter) >= 0;
        });

        devices.sort(function (a, b) {
            var av = sortKey === "name"
                ? ((FPD.DeviceCache.getDevice(a.deviceId) || {}).name || "").toLowerCase()
                : (a[sortKey] || 0);
            var bv = sortKey === "name"
                ? ((FPD.DeviceCache.getDevice(b.deviceId) || {}).name || "").toLowerCase()
                : (b[sortKey] || 0);
            if (typeof av === "string") return sortDir * av.localeCompare(bv);
            return sortDir * (bv - av);
        });

        if (devices.length === 0) {
            el.fpdTableBody.innerHTML = '<tr class="fpd-empty-row"><td colspan="8">No units found for this period.</td></tr>';
            return;
        }

        el.fpdTableBody.innerHTML = devices.map(function (d) {
            var dev = FPD.DeviceCache.getDevice(d.deviceId) || {};
            var name = dev.name || d.deviceId;
            var idleClass = d.idlePct > FPD.Constants.IDLE_TARGET_PCT ? " fpd-cell-warn" : "";
            var idleBadge = d.idlePct > 0
                ? (d.idlePct > FPD.Constants.IDLE_TARGET_PCT
                    ? '<span class="fpd-badge fpd-badge-bad">' + d.idlePct.toFixed(1) + '%</span>'
                    : d.idlePct.toFixed(1) + '%')
                : "--";
            return '<tr class="fpd-row">' +
                '<td class="fpd-name-cell" data-device-id="' + d.deviceId + '">' + esc(name) + '</td>' +
                '<td>' + (d.miles > 0 ? Math.round(d.miles).toLocaleString() : "--") + '</td>' +
                '<td>' + (d.fuelGallons > 0 ? d.fuelGallons.toFixed(1) : "--") + '</td>' +
                '<td><strong>' + (d.mpg > 0 ? d.mpg.toFixed(2) : "--") + '</strong></td>' +
                '<td>' + (d.engineHours > 0 ? Math.round(d.engineHours).toLocaleString() : "--") + '</td>' +
                '<td>' + idleBadge + '</td>' +
                '<td>' + (d.idleGallons > 0 ? d.idleGallons.toFixed(1) : "--") + '</td>' +
                '<td><button class="fpd-drill-btn" data-device-id="' + d.deviceId + '">Detail</button></td>' +
                '</tr>';
        }).join("");

        el.fpdTableBody.querySelectorAll(".fpd-drill-btn").forEach(function (btn) {
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                openDrillDown(btn.getAttribute("data-device-id"));
            });
        });

        el.fpdTableBody.querySelectorAll(".fpd-name-cell[data-device-id]").forEach(function (cell) {
            cell.addEventListener("click", function () {
                openDrillDown(cell.getAttribute("data-device-id"));
            });
        });
    }

    // ── Drill-Down ───────────────────────────────────────────────────

    function openDrillDown(deviceId) {
        var dev = FPD.DeviceCache.getDevice(deviceId) || {};
        var d = currentData.byDevice[deviceId];

        el.fpdDrillTitle.textContent = dev.name || deviceId;
        el.fpdDrillMPG.textContent = d && d.mpg > 0 ? d.mpg.toFixed(2) : "--";
        el.fpdDrillHours.textContent = d && d.engineHours > 0
            ? Math.round(d.engineHours).toLocaleString() : "--";
        el.fpdDrillIdle.textContent = d && d.idlePct > 0 ? d.idlePct.toFixed(1) + "%" : "--";
        el.fpdDrillMiles.textContent = d && d.miles > 0 ? Math.round(d.miles).toLocaleString() : "--";

        showView("drill");

        FPD.DataService.loadDeviceDaily(api, deviceId, currentFromDate, currentToDate, function (err, data) {
            if (err || !data) return;
            var points = FPD.Charts.buildDailyMPGPoints(data.fuelRecords, currentFromDate, currentToDate);
            FPD.Charts.drawLineChart(el.fpdDrillCanvas, points, {
                color: "#0077c8",
                yLabel: "MPG"
            });
            renderIdleList(data.idleEvents);
        });
    }

    function renderIdleList(events) {
        if (!el.fpdDrillIdleList) return;
        if (!events || events.length === 0) {
            el.fpdDrillIdleList.innerHTML = "<li><span>No idling events in this period.</span></li>";
            return;
        }
        var sorted = events.slice().sort(function (a, b) {
            return new Date(b.activeFrom) - new Date(a.activeFrom);
        }).slice(0, 20);

        el.fpdDrillIdleList.innerHTML = sorted.map(function (e) {
            var dur = (e.activeFrom && e.activeTo)
                ? Math.round((new Date(e.activeTo) - new Date(e.activeFrom)) / 1000 / 60) : 0;
            var dt = e.activeFrom ? new Date(e.activeFrom).toLocaleDateString() : "—";
            return "<li><span>" + esc(dt) + "</span><span>" + dur + " min</span></li>";
        }).join("");
    }

    // ── Export ───────────────────────────────────────────────────────

    function exportCSV() {
        if (!currentData) return;
        var rows = [["Name", "Miles", "Fuel (gal)", "MPG", "Engine Hours", "Idle %", "Idle Fuel (gal)"]];
        Object.values(currentData.byDevice).forEach(function (d) {
            var dev = FPD.DeviceCache.getDevice(d.deviceId) || {};
            rows.push([
                dev.name || d.deviceId,
                d.miles > 0 ? Math.round(d.miles) : "",
                d.fuelGallons > 0 ? d.fuelGallons.toFixed(1) : "",
                d.mpg > 0 ? d.mpg.toFixed(2) : "",
                d.engineHours > 0 ? Math.round(d.engineHours) : "",
                d.idlePct > 0 ? d.idlePct.toFixed(1) : "",
                d.idleGallons > 0 ? d.idleGallons.toFixed(1) : ""
            ]);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
        }).join("\n");
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

    function dateToInput(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
};
