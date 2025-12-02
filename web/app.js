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
		decision_legacy: d.decision_legacy ?? null,
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
		const opt = document.createElement("option");
		opt.value = c; opt.textContent = c;
		comunaSelect.appendChild(opt);
	});
	comunaSelect.addEventListener("change", () => {
		state.comuna = comunaSelect.value;
		render();
	});

	const sexoSelect = document.getElementById("sexoSelect");
	sexoSelect.addEventListener("change", () => {
		state.sexo = sexoSelect.value;
		render();
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
	const edadRangeValue = document.getElementById("edadRangeValue");
	const updateEdadLabel = () => edadRangeValue.textContent = `≤ ${+edadRange.value}`;
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
			const r = v.filter(x => (x.decision === "Rechazado")).length;
			return { n, rechazos: r, tasa: n ? (r / n) : 0 };
		},
		d => d.comuna
	);

	// Tomamos top 12 por tasa (y umbral de mínimo n)
	const MIN_N = 20;
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
		.call(d3.axisBottom(x))
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
		.attr("height", d => y(0) - y(d.tasa))
		.attr("fill", d => color(d.tasa))
		.on("mousemove", (event, d) => {
			tooltip.style("opacity", 1)
				.style("left", (event.pageX + 12) + "px")
				.style("top", (event.pageY + 12) + "px")
				.html(`<strong>${d.comuna}</strong><br>Tasa rechazo: ${percent(d.tasa)}<br>n=${d.n}, rechazados=${d.rechazos}`);
		})
		.on("mouseleave", () => tooltip.style("opacity", 0));
}

/* VIZ 2: Score por nacionalidad (Chilena vs Extranjera) */
function viz2(container, data) {
	const W = container.clientWidth;
	const H = container.clientHeight;
	const M = { top: 60, right: 24, bottom: 48, left: 70 };

	d3.select(container).selectAll("*").remove();
	const svg = d3.select(container).append("svg").attr("width", W).attr("height", H);

	const filtered = data.filter(d => d.score_riesgo != null);
	const groupLabel = d => (d.nacionalidad && d.nacionalidad.trim().toLowerCase() === "chilena") ? "Chilena" : "Extranjera";

	const groups = d3.groups(filtered, groupLabel).map(([k, arr]) => ({
		key: k,
		values: arr.map(d => d.score_riesgo).sort(d3.ascending)
	}));
	if (!groups.length) return;

	function quantiles(arr) {
		return {
			min: d3.min(arr),
			q1: d3.quantile(arr, 0.25),
			median: d3.quantile(arr, 0.5),
			q3: d3.quantile(arr, 0.75),
			max: d3.max(arr),
			n: arr.length,
			mean: d3.mean(arr)
		};
	}
	const stats = groups.map(g => ({ key: g.key, ...quantiles(g.values) }));

	const x = d3.scaleBand()
		.domain(stats.map(s => s.key))
		.range([M.left, W - M.right])
		.padding(0.45);
	// Escala Y basada en los datos (algunas implementaciones de score no son 0-100)
	const dataMin = d3.min(stats, s => s.min);
	const dataMax = d3.max(stats, s => s.max);
	let yMin = Math.floor((dataMin ?? 0) - 5);
	let yMax = Math.ceil((dataMax ?? 1) + 5);
	if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) {
		yMin = (dataMin ?? 0) - 1;
		yMax = (dataMax ?? 1) + 1;
	}
	const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([H - M.bottom, M.top]);

	// Ejes
	svg.append("g").attr("transform", `translate(0,${H - M.bottom})`).attr("class", "axis").call(d3.axisBottom(x));
	svg.append("g").attr("transform", `translate(${M.left},0)`).attr("class", "axis").call(d3.axisLeft(y).ticks(6));

	// Boxplots
	const boxWidth = Math.min(60, x.bandwidth());
	const gBox = svg.append("g");
	gBox.selectAll(".box").data(stats).join("g").each(function(s) {
		const g = d3.select(this);
		const cx = x(s.key) + (x.bandwidth() - boxWidth) / 2;
		g.append("rect").attr("x", cx).attr("y", y(s.q3)).attr("width", boxWidth).attr("height", Math.max(1, y(s.q1) - y(s.q3)))
			.attr("fill", s.key === "Extranjera" ? "#ef4444" : "#3b82f6").attr("opacity", 0.35);
		g.append("line").attr("x1", cx + 2).attr("x2", cx + boxWidth - 2).attr("y1", y(s.median)).attr("y2", y(s.median)).attr("stroke", "#e5e7eb").attr("stroke-width", 2);
		g.append("line").attr("x1", cx + boxWidth / 2).attr("x2", cx + boxWidth / 2).attr("y1", y(s.min)).attr("y2", y(s.q1)).attr("stroke", "#94a3b8");
		g.append("line").attr("x1", cx + boxWidth / 2).attr("x2", cx + boxWidth / 2).attr("y1", y(s.q3)).attr("y2", y(s.max)).attr("stroke", "#94a3b8");
		g.append("circle").attr("cx", cx + boxWidth / 2).attr("cy", y(s.mean)).attr("r", 3).attr("fill", "#f59e0b");
		g.append("text").attr("x", cx + boxWidth / 2).attr("y", Math.max(y(s.q3) - 8, M.top + 10)).attr("text-anchor", "middle").attr("class", "legend")
			.text(`n=${d3.format(",")(s.n)}`);
	});

	// Puntos jitter (muestra)
	const jitter = (boxWidth / 2) - 2;
	groups.forEach(grp => {
		const sample = grp.values.length > 400 ? d3.shuffle([...grp.values]).slice(0, 400) : grp.values;
		const cx = x(grp.key) + x.bandwidth() / 2;
		svg.append("g").attr("fill", grp.key === "Extranjera" ? "#ef4444" : "#3b82f6").attr("opacity", 0.25)
			.selectAll("circle").data(sample).join("circle")
			.attr("cx", () => cx + (Math.random() * 2 - 1) * jitter).attr("cy", d => y(d)).attr("r", 2);
	});

	// Delta media
	if (stats.length === 2) {
		const chil = stats.find(s => s.key === "Chilena");
		const ext = stats.find(s => s.key === "Extranjera");
		if (chil && ext) {
			const diff = (ext.mean - chil.mean);
			svg.append("text").attr("x", W / 2).attr("y", M.top - 24).attr("text-anchor", "middle").attr("fill", "#fbbf24")
				.text(`Δ media (Extranjera - Chilena): ${d3.format(".2f")(diff)}`);
		}
	}
}

/* VIZ 3: Histograma por edad (aprob/rechazado) */
function viz3(container, data) {
	const W = container.clientWidth;
	const H = container.clientHeight;
	const M = { top: 24, right: 24, bottom: 40, left: 60 };

	d3.select(container).selectAll("*").remove();
	const svg = d3.select(container).append("svg").attr("width", W).attr("height", H);

	const ages = data.filter(d => d.edad >= 18 && d.edad <= 90);

	const x = d3.scaleLinear().domain([18, 90]).nice().range([M.left, W - M.right]);

	const bins = d3.bin()
		.domain(x.domain())
		.thresholds(18)
		.value(d => d.edad)(ages);

	const grouped = bins.map(bin => {
		const aprob = bin.filter(d => d.decision === "Aprobado").length;
	const rechaz = bin.filter(d => d.decision === "Rechazado").length;
		return {
			x0: bin.x0, x1: bin.x1,
			total: bin.length,
			aprob,
			rechaz,
			tasa: bin.length ? (rechaz / bin.length) : 0
		};
	});

	const y = d3.scaleLinear()
		.domain([0, d3.max(grouped, d => d.total) || 1]).nice()
		.range([H - M.bottom, M.top]);
	const yRate = d3.scaleLinear()
		.domain([0, 1]).nice()
		.range([H - M.bottom, M.top]);

	svg.append("g")
		.attr("transform", `translate(0,${H - M.bottom})`)
		.attr("class", "axis")
		.call(d3.axisBottom(x).ticks(12));

	svg.append("g")
		.attr("transform", `translate(${M.left},0)`)
		.attr("class", "axis")
		.call(d3.axisLeft(y));

	// Eje derecho para tasa de rechazo
	svg.append("g")
		.attr("transform", `translate(${W - M.right},0)`)
		.attr("class", "axis")
		.call(d3.axisRight(yRate).tickFormat(d3.format(".0%")));

	const colorA = "#3b82f6";
	const colorR = "#ef4444";

	const bw = (x(grouped[0]?.x1 || 19) - x(grouped[0]?.x0 || 18)) - 4;

	// Barras apiladas (aprob/rechaz)
	svg.selectAll(".bar-edad")
		.data(grouped)
		.join("g")
		.attr("transform", d => `translate(${x(d.x0) + 2},0)`)
		.each(function(d) {
			const g = d3.select(this);
			const y0 = y(d.aprob + d.rechaz);
			g.append("rect")
				.attr("x", 0)
				.attr("y", y(d.aprob + d.rechaz))
				.attr("width", bw)
				.attr("height", y(0) - y(d.aprob + d.rechaz))
				.attr("fill", "#1f2937");

			g.append("rect")
				.attr("x", 0)
				.attr("y", y(d.rechaz))
				.attr("width", bw)
				.attr("height", y(0) - y(d.rechaz))
				.attr("fill", colorR);

			g.append("rect")
				.attr("x", 0)
				.attr("y", y(d.aprob + d.rechaz))
				.attr("width", bw)
				.attr("height", y(0) - y(d.aprob))
				.attr("fill", colorA)
				.attr("opacity", 0.85);
		});

	// Leyenda
	const legend = svg.append("g").attr("transform", `translate(${W - M.right - 180}, ${M.top})`);
	legend.append("rect").attr("x", 0).attr("y", 0).attr("width", 14).attr("height", 14).attr("fill", colorA);
	legend.append("text").attr("x", 20).attr("y", 11).attr("class", "legend").text("Aprobado");
	legend.append("rect").attr("x", 0).attr("y", 22).attr("width", 14).attr("height", 14).attr("fill", colorR);
	legend.append("text").attr("x", 20).attr("y", 33).attr("class", "legend").text("Rechazado");

	// Línea de tasa de rechazo
	const line = d3.line()
		.x(d => x((d.x0 + d.x1) / 2))
		.y(d => yRate(d.tasa));

	svg.append("path")
		.datum(grouped)
		.attr("fill", "none")
		.attr("stroke", "#fbbf24")
		.attr("stroke-width", 2)
		.attr("d", line);

	// puntos sobre la línea
	svg.selectAll(".rate-point")
		.data(grouped)
		.join("circle")
		.attr("class", "rate-point")
		.attr("cx", d => x((d.x0 + d.x1) / 2))
		.attr("cy", d => yRate(d.tasa))
		.attr("r", 3)
		.attr("fill", "#fbbf24");
}

/* VIZ 4: Boxplot score por nacionalidad (Chilena vs Extranjera) */
function viz4(container, data) {
	const W = container.clientWidth;
	const H = container.clientHeight;
	const M = { top: 60, right: 24, bottom: 48, left: 70 };

	d3.select(container).selectAll("*").remove();
	const svg = d3.select(container).append("svg").attr("width", W).attr("height", H);

	const filtered = data.filter(d => d.score_riesgo != null);
	const groupLabel = d => (d.nacionalidad && d.nacionalidad.trim().toLowerCase() === "chilena") ? "Chilena" : "Extranjera";

	const groups = d3.groups(filtered, groupLabel).map(([k, arr]) => ({
		key: k,
		values: arr.map(d => d.score_riesgo).sort(d3.ascending)
	}));

	if (!groups.length) return;

	function quantiles(arr) {
		return {
			min: d3.min(arr),
			q1: d3.quantile(arr, 0.25),
			median: d3.quantile(arr, 0.5),
			q3: d3.quantile(arr, 0.75),
			max: d3.max(arr),
			n: arr.length,
			mean: d3.mean(arr)
		};
	}

	const stats = groups.map(g => ({ key: g.key, ...quantiles(g.values) }));

	const x = d3.scaleBand()
		.domain(stats.map(s => s.key))
		.range([M.left, W - M.right])
		.padding(0.4);

	// Escala fija 0-100 para comparar bandas y filtros de forma consistente
	const y = d3.scaleLinear()
		.domain([0, 100]).nice()
		.range([H - M.bottom, M.top]);

	// Ejes
	svg.append("g")
		.attr("transform", `translate(0,${H - M.bottom})`)
		.attr("class", "axis")
		.call(d3.axisBottom(x));

	svg.append("g")
		.attr("transform", `translate(${M.left},0)`)
		.attr("class", "axis")
		.call(d3.axisLeft(y).ticks(6));
	svg.append("text")
		.attr("x", M.left - 40)
		.attr("y", M.top - 8)
		.attr("fill", "#94a3b8")
		.attr("text-anchor", "start")
		.attr("class", "legend")
		.text("score_riesgo");

	// Boxplots
	const boxWidth = Math.min(60, x.bandwidth() * 0.45);
	const gBox = svg.append("g");

	gBox.selectAll(".box")
		.data(stats)
		.join("g")
		.each(function(s) {
			const g = d3.select(this);
			const cx = x(s.key) + (x.bandwidth() - boxWidth) / 2;

			// big box Q1-Q3
			g.append("rect")
				.attr("x", cx)
				.attr("y", y(s.q3))
				.attr("width", boxWidth)
				.attr("height", Math.max(1, y(s.q1) - y(s.q3)))
				.attr("fill", s.key === "Extranjera" ? "#ef4444" : "#3b82f6")
				.attr("opacity", 0.35);

			// median line
			g.append("line")
				.attr("x1", cx + 2)
				.attr("x2", cx + boxWidth - 2)
				.attr("y1", y(s.median))
				.attr("y2", y(s.median))
				.attr("stroke", "#e5e7eb")
				.attr("stroke-width", 2);

			// whiskers
			g.append("line").attr("x1", cx + boxWidth / 2).attr("x2", cx + boxWidth / 2).attr("y1", y(s.min)).attr("y2", y(s.q1)).attr("stroke", "#94a3b8");
			g.append("line").attr("x1", cx + boxWidth / 2).attr("x2", cx + boxWidth / 2).attr("y1", y(s.q3)).attr("y2", y(s.max)).attr("stroke", "#94a3b8");

			// mean dot
			g.append("circle")
				.attr("cx", cx + boxWidth / 2)
				.attr("cy", y(s.mean))
				.attr("r", 3)
				.attr("fill", "#f59e0b");

			// n label (clamp para evitar que se pegue al borde superior)
			g.append("text")
				.attr("x", cx + boxWidth / 2)
				.attr("y", Math.max(y(s.q3) - 8, M.top + 10))
				.attr("text-anchor", "middle")
				.attr("class", "legend")
				.text(`n=${d3.format(",")(s.n)}`);
		});

	// Puntos con jitter para mostrar distribución (muestra hasta 400 por grupo)
	const jitter = boxWidth / 2 - 2;
	groups.forEach(grp => {
		const sample = grp.values.length > 400 ? d3.shuffle([...grp.values]).slice(0, 400) : grp.values;
		const cx = x(grp.key) + x.bandwidth() / 2;
		svg.append("g")
			.attr("fill", grp.key === "Extranjera" ? "#ef4444" : "#3b82f6")
			.attr("opacity", 0.25)
			.selectAll("circle")
			.data(sample)
			.join("circle")
			.attr("cx", () => cx + (Math.random() * 2 - 1) * jitter)
			.attr("cy", d => y(d))
			.attr("r", 2);
	});

	// Diferencia de medias (debajo del título del panel)
	if (stats.length === 2) {
		const chil = stats.find(s => s.key === "Chilena");
		const ext = stats.find(s => s.key === "Extranjera");
		if (chil && ext) {
			const diff = (ext.mean - chil.mean);
			svg.append("text")
				.attr("x", W / 2)
				.attr("y", M.top - 24)
				.attr("text-anchor", "middle")
				.attr("fill", "#fbbf24")
				.text(`Δ media (Extranjera - Chilena): ${d3.format(".2f")(diff)}`);
		}
	}
}
/* Render Coordinado */
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
	const dash = document.querySelector(".dashboard");
	const msg = document.createElement("div");
	msg.style.padding = "16px";
	msg.textContent = "No se pudo cargar data.json. Ejecuta primero el ETL para generarlo.";
	dash.prepend(msg);
});

