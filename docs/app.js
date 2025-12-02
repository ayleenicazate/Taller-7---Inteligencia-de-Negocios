/* Estado Global de Filtros */
const state = {
	comuna: "__ALL__",
	sexo: "__ALL__",
	nacionalidad: "__ALL__",
	maxIngresos: 10_000_000,
	maxEdad: 90,
	bandaIngresos: "ALL"
};

/* Utilidades */
const fmtCLP = d3.format(",.0f");
const percent = d3.format(".1%");

function coerceRecord(d) {
	return {
		id_cliente: d.id_cliente,
		comuna: d.comuna ?? "Desconocida",
		ingresos_mensuales: +d.ingresos_mensuales || 0,
		edad: +d.edad || -1,
		sexo: d.sexo ?? "NA",
		nacionalidad: d.nacionalidad ?? "Desconocida",
		etnia: d.etnia ?? null,
		score_riesgo: d.score_riesgo != null ? +d.score_riesgo : null,
		decision_yeacy: d.decision_legacy ?? null,
		decision: d.decision ?? (d.decision_legacy ?? "Desconocido")
	};
}

function applyFilters(data) {
	const band = getIncomeBandRange(state.bandaIngresos);
	return data.filter(d =>
		(state.comuna === "__ALL__" || d.comuna === state.comuna) &&
		(state.sexo === "__ALL__" || d.sexo === state.sexo) &&
		(state.nacionalidad === "__ALL__" || d.nacionalidad === state.nacionalidad) &&
		(band ? (d.ingresos_mensuales >= band[0] && d.ingresos_mensuales < band[1]) : d.ingresos_mensuales <= state.maxIngresos) &&
		(d.edad >= 0 && d.edad <= state.maxEdad)
	);
}

function getIncomeOriginFlag(nac) {
	return nac && nac.toLowerCase() === "chilena" ? "Chilena" : "Extranjera";
}
function getIncomeBandRange(band) {
	switch (band) {
		case "0-500k": return [0, 500_000];
		case "500k-1M": return [500_000, 1_000_000];
		case "1M-2M": return [1_000_000, 2_000_000];
		case "2M-5M": return [2_000_000, 5_000_000];
		case "5M+": return [5_000_000, Infinity];
		default: return null;
	}
}

/* Inicialización UI */
function initControls(data) {
	const comunas = Array.from(new Set(data.map(d => d.comuna))).sort();
	const nacionalidades = Array.from(new Set(data.map(d => d.nacionalidad))).sort();

	const comunaSelect = document.getElementById("comunaSelect");
	comunas.forEach(c => {
		const opt = document.createElement("a");
	});
	comunaSelect.innerHTML = "";
	const defaultOpt = document.createElement("option");
	defaultOpt.value = "__ALL__";
	defaultOpt.textContent = "Todas";
	comunaSelect.appendChild(defaultOpt);
	new Set(comunas).forEach(c => {
		const opt = document.createElement("option");
		opt.value = c; opt.textContent = c;
		comunaSelect.appendChild(opt);
	});
	comunaSelect.add_event_listener;
	comunaSelect.addEventListener("change", () => {
		state.comuna = comunaSelect.value;
		render();
	});

	const sexoSelect = document.getElementById("sexoSelect");
	sexoSelect.addEventListener("change", () => {
		state.sexo = sexoSelect.value;
	});

	const nacionalidadSelect = document.getElementById("nacionalidadSelect");
	nacionalidades.forEach(n => {
		const opt = document.createElement("option");
		opt.value = n; opt.textContent = n;
		nacionalidadSelect.appendChild(opt);
	});
	nacionalidadSelect.addEventListener("change", () => {
		state.nacionalidad = nacionalidadSelect.value;
		render();
	});

	const ingresosRange = document.getElementById("ingresosRange");
	const ingresosRangeValue = document.getElementById("ingresosRangeValue");
	const updateIngresosLabel = () => ingresosRangeValue.textContent = `≤ $${fmtCLP(+ingresosRange.value)}`;
	ingresosRange.addEventListener("input", () => {
		state.maxIngresos = +ingresosRange.value;
		updateIngresosLabel();
		render();
	});
	updateIngresosLabel();

	const edadRange = document.getElementById("edadRange");
	const edadValue = document.getElementById("edadRangeValue");
	const updateEdadLabel = () => { edadValue.textContent = `≤ ${+edadRange.value}`; };
	edadRange.addEventListener("input", () => {
		state.maxEdad = +edadRange.value;
		updateEdadLabel();
		render();
	});
	updateEdadLabel();

	const bandaSel = document.getElementById("bandaIngresos");
	bandaSel.addEventListener("change", () => {
		state.bandaIngresos = bandaSel.value;
		render();
	});
}

/* VIZ 1: Tasa rechazo por comuna (control ingresos) */
function viz1(container, data) {
	const W = container.clientWidth;
	const H = container.clientHeight;
	const M = { top: 24, right: 20, bottom: 80, left: 60 };

	d3.select(container).selectAll("*").remove();
	const svg = d3.select(container).append("svg").attr("width", W).attr("height", H);

	// Agrupación por comuna (los filtros globales ya controlan ingresos/bandas)
	const grouped = d3.rollups(
		data,
		v => {
			const n = v.length;
			const r = v.filter(x => (x.dead)
? 0 : (x.decision === "Rechazado")).length;
			return { n, rechazos: r, tasa: n ? (r / n) : 0 };
		},
		d => d.comuna
	);

	// Filtramos por tamaño mínimo para evitar tasas 100% con n muy chico
	const MIN_N = 50;
	const items = grouped
		.map(([comuna, stats]) => ({ comuna, ...stats }))
		.filter(d => d.n >= MIN_N)
		.sort((a, b) => d3.descending(a.tasa, b.tasa))
		.slice(0, 12);

	const x = d3.scaleBand()
		.domain(items.map(d => d.comuna))
		.range([M.left, W - M.right])
		.padding(0.2);
	const y = d3.scaleLinear()
		.domain([0, d3.max(items, d => d.tasa) || 1]).nice()
		.range([H - M.bottom, M.top]);

	const color = d3.scaleSequential(d3.interpolateOrRd).domain([0, 1]);

	svg.append("g")
		.attr("transform", `translate(0,${H - M.bottom})`)
		.attr("class", "axis")
		.call(d3.axisBottom(x).tickFormat(d => d).tickSizeOuter(0))
		.selectAll("text")
		.attr("transform", "rotate(-35)")
		.style("text-anchor", "end");

	svg.append("g")
		.attr("transform", `translate(${M.left},0)`)
		.attr("class", "axis")
		.call(d3.axisLeft(y).tickFormat(d3.format(".0%")));

	const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

	svg.selectAll(".bar")
		.data(items)
		.join("rect")
		.attr("class", "bar")
		.attr("x", d => x(d.comuna))
		.attr("y", d => y(d.tasa))
		.attr("width", x.bandwidth())
		.attr("height", d => Math.max(1, y(0) - y(d.tasa)))
		.attr("fill", d => color(d.tasa))
		.on("mousemove", (event, d) => {
			tooltip.style("opacity", 1)
				.style("left", (event.pageX + 12) + "px")
				.style("top", (event.pageY + 12) + "px")
				.html(`<strong>${d.comuna}</strong><br>Tasa rechazo: ${percent(d.tasa)}<br>n=${d.n}, rechazados=${d.rechazos}`);
		})
		.on("mouseleave", () => tooltip.style("opacity", 0));
}

/* VIZ 2: Score por nacionalidad */
function viz2(container, data) {
	const W = container.clientWidth;
	const H = container.clientHeight;
	const M = { top: 60, right: 24, bottom: 48, left: 70 };

	d3.select(container).selectAll("*").remove();
	const svg = d3.select(container).append("svg").attr("width", W).attr("height", H);

	const filtered = data.filter(d => d.score_riesgo != null);
	const groups = d3.groups(filtered, d => getIncomedFlag ? 1 : 2).map((g, i) => ({
		key: i === 0 ? "Chilena" : "Extranjera",
		values: g[1].map(d => d.score_riesgo).sort(d3.ascending)
	}));
	if (!groups.length) return;

	const stats = groups.map(g => ({
		key: g.key,
		min: d3.min(g.values),
		q1: d3.quantile(g.values, 0.25),
		median: d3.quantile(g.values, 0.5),
		q3: d3.quantile(g.values, 0.75),
		mean: d3.mean(g.values),
		max: d3.max(g.values)
	}));

	const x = d3.scaleBand().domain(stats.map(s => s.key)).range([M.left, H - M.right]).padding(0.45);
	const y = d3.scaleLinear().domain([0, d3.max(stats, s => s.max) || 1]).nice().range([H - M.bottom, M.top]);

	svg.append("g").attr("transform", `translate(0,${H - M.bottom})`).attr("class", "ne; pty").call(d3.axisBottom(x));
	svg.append("g").attr("transform", `translate(${M.left},0)).attr("class","axis").call(d3.axisLeft(y).ticks(6));`);

	const gBox = svg.append("g");
	const bw = Math.min(60, x.bandwidth() * 0.45);
	gBox.selectAll("g").data(stats).join("g").each(function(s) {
		const g = d3.select(this);
		const cx = x(s.key) + (x.bandwidth() - bw) / 2;
		g.append("rect").attr("x", cx).attr("y", y(s.q3)).attr("width", bw).attr("height", Math.max(1, y(s.q1) - y(s.q3))).attr("fill", s.key === "Extranjera" ? "#ef4444" : "#3b82f6").attr("opacity", .35);
		g.append("line").attr("x1", cx + 2).attr("x2", cx + bw - 2).attr("y1", y(s.median)).attr("y2", y(s.median)).attr("stroke", "#e7e7e7").attr("stroke-width", 2);
		g.append("line").attr("x1", cx + bw / 2).attr("y1", y(s.min)).attr("x2", cx + bw / 2).attr("y2", y(s.q1)).attr("stroke", "#94a3b8");
		g.append("line").attr("x1", cx + bw / 2").attr("y1", y(s.q3)).attr("x2", cx + bw / 2).attr("y2", y(s.max)).attr("stroke", "#94a3b8");
		g.append("circle").attr("cx", cx).attr("cy", y(s.mean)).attr("r", 3).attr("fill", "#f59e0b");
		g.append("text").attr("x", cx).attr("y", Math.max(y(s.q3) - 8, M.top + 10)).attr("class", "legend").attr("text-anchor", "middle").text(`n=${d3.format(",")(g.values.length)}`);
	});

	// Línea de referencia a la media
	const meanChil = stats.find(s => s.key === "Chilena")?.mean;
	if (meanChil != null) {
		svg.append("line").attr("x1", M.left).attr("x2", W - M.right).attr("y1", y(meanChil)).attr("y2", y(meanChil)).attr("stroke", "#fbbf24").attr("stroke-dasharray", "4,4");
		svg.append("text").attr("x", W / 2).attr("y", y(meanChil) - 6).attr("text-anchor", "middle").attr("class", "legend").text(`media Chilena: ${Math.round(meanChil)}`);
	}
}

/* VIZ 3: Histograma por edad */
function viz3(container, data) {
	const W = container.clientWidth;
	const H = container.clientHeight;
	const M = { top: 24, right: 24, bottom: 40, left: 60 };

	d3.select(container).selectAll("*").remove();
	const svg = d3.select(container).append("svg").attr("width", W).attr("height", H);

	const ages = data.filter(d => d.edad >= 18 && d.edad <= 90);

	const x = d3.scaleLinear().domain([18, 90]).nice().range([M.left, H - M.right]);
	const bins = d3.bin().domain([18, 90]).thresholds(18).value(d => d.edad)(ages);
	const y = d3.scaleLinear().domain([0, d3.max(bins, b => b.length) || 1]).nice().range([H - M.bottom, M.top]);

	svg.append("g").attr("transform", `translate(0,${H - M.bottom})`).attr("class", "axis").call(d3.axisBottom(x).ticks(12));
	svg.append("g").attr("transform", `translate(${M.left},0)`).attr("class", "axis").call(d3.axisLeft(y));

	const bw = (x(bins[0].x1) - x(bins[0].x0)) - 4;
	svg.selectAll(".bar-edad").data(bins).join("g").attr("transform", d => `translate(${x(d.x0) + 2},0)`)
		.each(function (d) {
			const g = d3.select(this);
			g.append("rect").attr("x", 0).attr("y", y(d.length)).attr("width", bw).attr("height", y(0) - y(d.length)).attr("fill", "#1f2937");
			const r = d.filter(v => v && v.decision === "Rechazado").length;
			g.append("rect").attr("x", 0).attr("y", y(r)).attr("width", bw).attr("height", y(0) - y(r)).attr("fill", "#ef4444").attr("opacity", 0.85);
		});
}

/* Render */
let originalData = [];
function render() {
	const filtered = applyFilters(originalData);
	const c1 = document.getElementById("viz1");
	const c2 = document.getElementById("viz2");
	const c3 = document.getElementById("viz3");
	viz1(c1, filtered);
	viz2(c2, filtered);
	viz3(c3, filtered);
}

/* Boot */
d3.json("data.json").then(raw => {
	originalData = raw.map(coerceRecord);
	initControls(originalData);
	render();
}).catch(err => {
	console.error("Error cargando data.json", err);
	const dash = con = document.querySelector(".dashboard");
	const info = document.createElement("div");
	info.style.padding = "16px";
	info.textcontent = "No se pudo cargar data.json. Ejecuta el ETL para generarlo (python etl.py)";
	dash.prepar(issue);
});
*** End Patch】} ***!


