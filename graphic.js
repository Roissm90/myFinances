(() => {
  const dashboardStatus = document.getElementById("dashboardStatus");
  const dashboardChartAll = document.getElementById("dashboardChartAll");
  const dashboardTrack = document.getElementById("dashboardTrack");
  const dashboardPrev = document.getElementById("dashboardPrev");
  const dashboardNext = document.getElementById("dashboardNext");
  const totalIncomeEl = document.getElementById("totalIncome");
  const totalExpensesEl = document.getElementById("totalExpenses");
  const totalNetEl = document.getElementById("totalNet");

  let dashboardCharts = [];
  let desktopChart = null;
  let lastFiles = [];
  let currentSlide = 0;

  const MONTH_ORDER = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];

  const parseAmount = (value) => {
    const normalized = String(value ?? "")
      .replace(/\./g, "")
      .replace(/,/g, ".");
    const numberValue = Number(normalized);
    return Number.isNaN(numberValue) ? 0 : numberValue;
  };

  const formatCurrency = (value) =>
    value.toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const getMonthKeyFromFile = (fileName) =>
    String(fileName ?? "")
      .replace(/^movimientos-/, "")
      .replace(/\.json$/i, "")
      .trim();

  const formatMonthLabel = (fileName) => {
    const baseName = getMonthKeyFromFile(fileName)
      .replace(/[_-]+/g, " ")
      .trim();

    const normalized = baseName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return normalized
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const sortFilesByMonth = (files) => {
    const getIndex = (fileName) => {
      const monthToken = getMonthKeyFromFile(fileName)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/\s|_/)[0];
      const index = MONTH_ORDER.indexOf(monthToken);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };

    return [...files].sort((a, b) => {
      const indexA = getIndex(a);
      const indexB = getIndex(b);
      if (indexA !== indexB) {
        return indexA - indexB;
      }
      return a.localeCompare(b);
    });
  };

  const setDashboardStatus = (message) => {
    if (dashboardStatus) {
      dashboardStatus.textContent = message;
    }
  };

  const fetchMovementsForFile = async (fileName) => {
    const response = await fetch(`/uploads/${encodeURIComponent(fileName)}`);
    if (!response.ok) {
      throw new Error("Error al cargar movimientos");
    }
    return response.json();
  };

  const updateTotalsUI = (income, expenses, net) => {
    if (totalIncomeEl) {
      totalIncomeEl.textContent = formatCurrency(income);
    }
    if (totalExpensesEl) {
      totalExpensesEl.textContent = formatCurrency(expenses);
    }
    if (totalNetEl) {
      totalNetEl.textContent = formatCurrency(net);
    }
  };

  const destroyCharts = () => {
    dashboardCharts.forEach((chart) => chart.destroy());
    dashboardCharts = [];
    if (desktopChart) {
      desktopChart.destroy();
      desktopChart = null;
    }
  };

  const renderDesktopChart = (labels, incomeData, expensesData, netData) => {
    if (!dashboardChartAll) {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 992px)").matches;
    if (!isDesktop) {
      return;
    }

    desktopChart = new window.Chart(dashboardChartAll, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Ingresos",
            data: incomeData,
            backgroundColor: "#2e7d32",
          },
          {
            label: "Gastos",
            data: expensesData,
            backgroundColor: "#c62828",
          },
          {
            label: "Neto",
            data: netData,
            backgroundColor: "#005e2a",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
          },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });
  };

  const renderSlide = (label, income, expenses, net) => {
    const slide = document.createElement("div");
    slide.className = "dashboard-slide";

    const title = document.createElement("p");
    title.className = "dashboard-slide-title";
    title.textContent = label;
    slide.appendChild(title);

    const chartWrap = document.createElement("div");
    chartWrap.className = "dashboard-chart";
    const canvas = document.createElement("canvas");
    canvas.height = 180;
    chartWrap.appendChild(canvas);
    slide.appendChild(chartWrap);

    dashboardTrack.appendChild(slide);

    const chart = new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Ingresos", "Gastos", "Neto"],
        datasets: [
          {
            label: label,
            data: [income, expenses, net],
            backgroundColor: ["#2e7d32", "#c62828", "#005e2a"],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => formatCurrency(context.parsed.y),
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });

    dashboardCharts.push(chart);
  };

  const updateDashboard = async (files) => {
    if (!dashboardTrack) {
      return;
    }

    if (!window.Chart) {
      setDashboardStatus("No se pudo cargar el grafico.");
      return;
    }

    if (!files.length) {
      setDashboardStatus("Sin datos para mostrar.");
      destroyCharts();
      dashboardTrack.innerHTML = "";
      updateTotalsUI(0, 0, 0);
      return;
    }

    lastFiles = files;
    setDashboardStatus("Actualizando resumen...");
    const sortedFiles = sortFilesByMonth(files);

    try {
      destroyCharts();
      dashboardTrack.innerHTML = "";
      currentSlide = 0;

      let totalIncome = 0;
      let totalExpenses = 0;
      const labels = [];
      const incomeData = [];
      const expensesData = [];
      const netData = [];

      for (const fileName of sortedFiles) {
        const movements = await fetchMovementsForFile(fileName);
        const list = Array.isArray(movements) ? movements : [];
        const income = list.reduce((sum, item) => {
          const amount = parseAmount(item?.importe);
          return amount > 0 ? sum + amount : sum;
        }, 0);
        const expenses = list.reduce((sum, item) => {
          const amount = parseAmount(item?.importe);
          return amount < 0 ? sum + Math.abs(amount) : sum;
        }, 0);
        const net = income - expenses;

        totalIncome += income;
        totalExpenses += expenses;

        labels.push(formatMonthLabel(fileName));
        incomeData.push(Number(income.toFixed(2)));
        expensesData.push(Number(expenses.toFixed(2)));
        netData.push(Number(net.toFixed(2)));

        renderSlide(
          labels[labels.length - 1],
          Number(income.toFixed(2)),
          Number(expenses.toFixed(2)),
          Number(net.toFixed(2))
        );
      }

      updateTotalsUI(totalIncome, totalExpenses, totalIncome - totalExpenses);
      renderDesktopChart(labels, incomeData, expensesData, netData);
      updateSliderButtons();
      setDashboardStatus("Resumen actualizado.");
    } catch (error) {
      console.error(error);
      setDashboardStatus("No se pudo cargar el resumen.");
    }
  };

  window.dashboardUI = {
    updateDashboard,
  };

  const updateSliderButtons = () => {
    const slideCount = dashboardTrack?.children?.length || 0;
    if (dashboardPrev) {
      dashboardPrev.disabled = currentSlide <= 0;
    }
    if (dashboardNext) {
      dashboardNext.disabled = currentSlide >= slideCount - 1;
    }
  };

  const scrollToSlide = (index) => {
    if (!dashboardTrack) {
      return;
    }
    const slides = Array.from(dashboardTrack.children);
    const target = slides[index];
    if (!target) {
      return;
    }
    currentSlide = index;
    dashboardTrack.scrollTo({
      left: target.offsetLeft,
      behavior: "smooth",
    });
    updateSliderButtons();
  };

  if (dashboardPrev) {
    dashboardPrev.addEventListener("click", () => {
      scrollToSlide(Math.max(0, currentSlide - 1));
    });
  }

  if (dashboardNext) {
    dashboardNext.addEventListener("click", () => {
      const slideCount = dashboardTrack?.children?.length || 0;
      scrollToSlide(Math.min(slideCount - 1, currentSlide + 1));
    });
  }

  window.addEventListener("resize", () => {
    if (lastFiles.length) {
      updateSliderButtons();
    }
  });
})();
