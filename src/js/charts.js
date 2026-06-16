/**
 * charts.js — Canvas-based charts for Fleet Performance Dashboard.
 */
var FPD = FPD || {};

FPD.Charts = (function () {
    "use strict";

    var C = FPD.Constants;

    // ── Line Chart ────────────────────────────────────────────────────

    /**
     * Draw an MPG trend line chart on a canvas element.
     * @param {HTMLCanvasElement} canvas
     * @param {Array} points - [{ label, value }]
     * @param {Object} opts - { title, color, targetLine, yLabel }
     */
    function drawLineChart(canvas, points, opts) {
        if (!canvas || !points || points.length === 0) return;
        opts = opts || {};
        var ctx = canvas.getContext("2d");
        var W = canvas.width, H = canvas.height;
        var PAD = { top: 36, right: 20, bottom: 48, left: 56 };
        var chartW = W - PAD.left - PAD.right;
        var chartH = H - PAD.top - PAD.bottom;

        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);

        // Data range
        var values = points.map(function (p) { return p.value; }).filter(function (v) { return v > 0; });
        if (values.length === 0) {
            drawEmpty(ctx, W, H, "No data for selected period");
            return;
        }
        var minV = Math.min.apply(null, values) * 0.9;
        var maxV = Math.max.apply(null, values) * 1.1;
        if (opts.targetLine) {
            minV = Math.min(minV, opts.targetLine * 0.9);
            maxV = Math.max(maxV, opts.targetLine * 1.1);
        }
        var range = maxV - minV || 1;

        function xPos(i) { return PAD.left + (i / (points.length - 1 || 1)) * chartW; }
        function yPos(v) { return PAD.top + chartH - ((v - minV) / range) * chartH; }

        // Grid lines
        ctx.strokeStyle = "#f0f0f0";
        ctx.lineWidth = 1;
        for (var gi = 0; gi <= 4; gi++) {
            var gy = PAD.top + (gi / 4) * chartH;
            ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(PAD.left + chartW, gy); ctx.stroke();
            var gVal = maxV - (gi / 4) * range;
            ctx.fillStyle = "#9e9e9e";
            ctx.font = "11px -apple-system, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(gVal.toFixed(1), PAD.left - 6, gy + 4);
        }

        // Target line
        if (opts.targetLine) {
            var ty = yPos(opts.targetLine);
            ctx.save();
            ctx.strokeStyle = "#ff9800";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(PAD.left + chartW, ty); ctx.stroke();
            ctx.fillStyle = "#ff9800";
            ctx.font = "11px -apple-system, sans-serif";
            ctx.textAlign = "left";
            ctx.fillText("Target " + opts.targetLine.toFixed(1), PAD.left + 4, ty - 4);
            ctx.restore();
        }

        // Area fill
        ctx.beginPath();
        var color = opts.color || "#1976d2";
        var firstValid = -1;
        points.forEach(function (p, i) {
            if (p.value <= 0) return;
            if (firstValid < 0) firstValid = i;
            var x = xPos(i), y = yPos(p.value);
            if (firstValid === i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.stroke();
        // Fill under
        if (firstValid >= 0) {
            ctx.lineTo(xPos(points.length - 1), PAD.top + chartH);
            ctx.lineTo(xPos(firstValid), PAD.top + chartH);
            ctx.closePath();
            var grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
            grad.addColorStop(0, color.replace(")", ",0.18)").replace("rgb", "rgba").replace("#", "rgba(").replace(")", ",0.18)"));
            grad.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = color + "22";
            ctx.fill();
        }
        ctx.restore();

        // Data points
        points.forEach(function (p, i) {
            if (p.value <= 0) return;
            ctx.beginPath();
            ctx.arc(xPos(i), yPos(p.value), 3.5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });

        // X-axis labels (show every Nth)
        var step = Math.max(1, Math.ceil(points.length / 7));
        ctx.fillStyle = "#9e9e9e";
        ctx.font = "10px -apple-system, sans-serif";
        ctx.textAlign = "center";
        points.forEach(function (p, i) {
            if (i % step !== 0 && i !== points.length - 1) return;
            ctx.fillText(p.label, xPos(i), PAD.top + chartH + 18);
        });

        // Title
        if (opts.title) {
            ctx.fillStyle = "#424242";
            ctx.font = "bold 13px -apple-system, sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(opts.title, PAD.left, 22);
        }

        // Y-axis label
        if (opts.yLabel) {
            ctx.save();
            ctx.translate(14, PAD.top + chartH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = "#9e9e9e";
            ctx.font = "11px -apple-system, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(opts.yLabel, 0, 0);
            ctx.restore();
        }
    }

    function drawEmpty(ctx, W, H, msg) {
        ctx.fillStyle = "#bdbdbd";
        ctx.font = "13px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(msg || "No data", W / 2, H / 2);
    }

    /**
     * Build daily MPG points from FuelUsed records.
     * @param {Array} fuelRecords
     * @param {Date} fromDate
     * @param {Date} toDate
     * @returns {Array} [{ label: "Jun 1", value: mpg }]
     */
    function buildDailyMPGPoints(fuelRecords, fromDate, toDate) {
        var byDay = {};
        fuelRecords.forEach(function (r) {
            if (!r.dateTime) return;
            var d = new Date(r.dateTime);
            var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
            if (!byDay[key]) byDay[key] = { fuelL: 0, distM: 0 };
            byDay[key].fuelL += (r.volume || 0);
            byDay[key].distM += (r.distance || 0);
        });

        var points = [];
        var cur = new Date(fromDate);
        cur.setHours(0, 0, 0, 0);
        var end = new Date(toDate);
        while (cur <= end) {
            var key = cur.getFullYear() + "-" + pad(cur.getMonth() + 1) + "-" + pad(cur.getDate());
            var dayData = byDay[key];
            var mpg = 0;
            if (dayData && dayData.fuelL > 0.1) {
                var gallons = dayData.fuelL / FPD.Constants.LITERS_PER_GALLON;
                var miles = dayData.distM / 1000 / FPD.Constants.KM_PER_MILE;
                mpg = miles / gallons;
            }
            var label = (cur.getMonth() + 1) + "/" + cur.getDate();
            points.push({ label: label, value: mpg });
            cur.setDate(cur.getDate() + 1);
        }
        return points;
    }

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    return { drawLineChart, buildDailyMPGPoints };
})();
