(() => {
  const STORAGE_KEY_EXCLUDED = 'airbnb_excluded_countries';
  const STORAGE_KEY_VERSION = 'airbnb_app_version';
  const DEFAULT_EXCLUDED_COUNTRIES = ['Vietnam', 'Việt Nam', 'Indonesia', 'Malaysia'];

  let excludedCountries = loadExcludedCountries();
  let currentJobId = null;
  let eventSource = null;
  let isRunning = false;
  let defaultKeywords = { mandatory: [], bonus: [], excluded: [] };

  // DOM Elements
  const form = document.getElementById('scraperForm');
  const cityInput = document.getElementById('city');
  const countryInput = document.getElementById('country');
  const excludedTagsContainer = document.getElementById('excludedTagsContainer');
  const excludedCountryInput = document.getElementById('excludedCountryInput');
  const addExcludedBtn = document.getElementById('addExcludedBtn');
  const resetExcludedBtn = document.getElementById('resetExcludedBtn');
  const guardrailMessage = document.getElementById('guardrailMessage');
  const iterationsInput = document.getElementById('iterations');
  const targetRawInput = document.getElementById('targetRaw');
  const minHostsInput = document.getElementById('minHostsPerBuilding');
  const proxyUrlInput = document.getElementById('proxyUrl');
  const delayMsInput = document.getElementById('delayMs');
  const headlessCheckbox = document.getElementById('headless');
  const exportOnlyCheckbox = document.getElementById('exportOnly');

  const kwMandatoryEl = document.getElementById('kwMandatory');
  const kwBonusEl = document.getElementById('kwBonus');
  const kwExcludedEl = document.getElementById('kwExcluded');
  const resetKeywordsBtn = document.getElementById('resetKeywordsBtn');

  const toggleAdvancedBtn = document.getElementById('toggleAdvancedBtn');
  const advancedPanel = document.getElementById('advancedPanel');
  const advancedArrow = document.getElementById('advancedArrow');

  const guardrailAlert = document.getElementById('guardrailAlert');
  const actionBtn = document.getElementById('actionBtn');

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const versionBadgeBtn = document.getElementById('versionBadgeBtn');
  const versionBadgeText = document.getElementById('versionBadgeText');
  const updateBanner = document.getElementById('updateBanner');
  const updateBannerText = document.getElementById('updateBannerText');
  const closeUpdateBannerBtn = document.getElementById('closeUpdateBannerBtn');
  const changelogModal = document.getElementById('changelogModal');
  const modalVersionSub = document.getElementById('modalVersionSub');
  const modalUpdatedAt = document.getElementById('modalUpdatedAt');
  const modalChangelogList = document.getElementById('modalChangelogList');
  const closeChangelogModalBtn = document.getElementById('closeChangelogModalBtn');
  const okChangelogModalBtn = document.getElementById('okChangelogModalBtn');

  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const progressLabel = document.getElementById('progressLabel');
  const terminalLog = document.getElementById('terminalLog');
  const clearLogBtn = document.getElementById('clearLogBtn');

  const reportsList = document.getElementById('reportsList');
  const refreshReportsBtn = document.getElementById('refreshReportsBtn');

  const previewCitySelect = document.getElementById('previewCitySelect');
  const refreshDbBtn = document.getElementById('refreshDbBtn');
  const kpiClean = document.getElementById('kpiClean');
  const kpiHighRise = document.getElementById('kpiHighRise');
  const kpiBuildings = document.getElementById('kpiBuildings');
  const kpiAvgPrice = document.getElementById('kpiAvgPrice');

  const tabBuildingsBtn = document.getElementById('tabBuildingsBtn');
  const tabListingsBtn = document.getElementById('tabListingsBtn');
  const tabExternalBtn = document.getElementById('tabExternalBtn');
  const tabBuildings = document.getElementById('tabBuildings');
  const tabListings = document.getElementById('tabListings');
  const tabExternal = document.getElementById('tabExternal');
  const buildingsTableBody = document.getElementById('buildingsTableBody');
  const listingsTableBody = document.getElementById('listingsTableBody');
  const externalTableBody = document.getElementById('externalTableBody');

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(input) {
    if (!input || typeof input !== 'string') return '';
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function loadExcludedCountries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EXCLUDED);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((c) => String(c).trim()).filter(Boolean);
        }
      }
    } catch {
      // Ignore storage read error
    }
    return [...DEFAULT_EXCLUDED_COUNTRIES];
  }

  function saveExcludedCountries() {
    try {
      localStorage.setItem(STORAGE_KEY_EXCLUDED, JSON.stringify(excludedCountries));
    } catch {
      // Ignore storage write error
    }
  }

  function renderExcludedTags() {
    if (excludedCountries.length === 0) {
      excludedTagsContainer.innerHTML =
        '<span class="text-[11px] text-slate-400 italic">Chưa có quốc gia nào trong danh sách chặn.</span>';
      return;
    }

    excludedTagsContainer.innerHTML = excludedCountries
      .map(
        (country, idx) => `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800 border border-rose-200">
          <span>${escapeHtml(country)}</span>
          <button
            type="button"
            data-remove-index="${idx}"
            title="Xóa ${escapeHtml(country)}"
            class="w-4 h-4 rounded-full inline-flex items-center justify-center hover:bg-rose-200 text-rose-700 font-bold leading-none"
          >&times;</button>
        </span>
      `
      )
      .join('');
  }

  function addExcludedCountry(rawValue) {
    const val = String(rawValue || '').trim();
    if (!val) return;
    const normVal = normalizeText(val);
    const exists = excludedCountries.some((c) => normalizeText(c) === normVal);
    if (!exists) {
      excludedCountries.push(val);
      saveExcludedCountries();
      renderExcludedTags();
      validateGuardrail();
    }
    excludedCountryInput.value = '';
  }

  function removeExcludedCountry(index) {
    if (index >= 0 && index < excludedCountries.length) {
      excludedCountries.splice(index, 1);
      saveExcludedCountries();
      renderExcludedTags();
      validateGuardrail();
    }
  }

  function findMatchedExcludedCountry(country) {
    const norm = normalizeText(country);
    if (!norm) return null;
    for (const item of excludedCountries) {
      const normItem = normalizeText(item);
      if (!normItem) continue;
      if (norm === normItem) return item;
      if (normItem.length > 2 && norm.includes(normItem)) return item;
    }
    return null;
  }

  function validateGuardrail() {
    const matched = findMatchedExcludedCountry(countryInput.value);
    const blocked = Boolean(matched);
    if (blocked) {
      guardrailMessage.textContent = `Quốc gia "${countryInput.value.trim()}" trùng với danh sách loại trừ ("${matched}"). Không thể chạy thu thập.`;
      guardrailAlert.classList.remove('hidden');
      countryInput.classList.add('border-red-500', 'bg-red-50', 'text-red-800');
      if (!isRunning) {
        actionBtn.disabled = true;
      }
    } else {
      guardrailAlert.classList.add('hidden');
      countryInput.classList.remove('border-red-500', 'bg-red-50', 'text-red-800');
      if (!isRunning) {
        actionBtn.disabled = false;
      }
    }
    return !blocked;
  }

  function setRunningState(running) {
    isRunning = running;
    if (running) {
      actionBtn.disabled = false;
      actionBtn.textContent = 'Dừng';
      actionBtn.classList.remove('bg-rose-600', 'hover:bg-rose-700');
      actionBtn.classList.add('bg-red-700', 'hover:bg-red-800');
      statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
      statusText.textContent = 'Đang chạy...';
    } else {
      actionBtn.textContent = 'Bắt đầu chạy';
      actionBtn.classList.remove('bg-red-700', 'hover:bg-red-800');
      actionBtn.classList.add('bg-rose-600', 'hover:bg-rose-700');
      statusDot.className = 'w-2 h-2 rounded-full bg-slate-400';
      statusText.textContent = 'Sẵn sàng';
      validateGuardrail();
    }
  }

  function updateStepCards(activeStep, isDone = false) {
    for (let i = 1; i <= 4; i++) {
      const card = document.getElementById(`stepCard${i}`);
      if (!card) continue;
      card.className = 'step-card rounded-lg border p-2.5 transition';
      if (isDone || i < activeStep) {
        card.classList.add('border-emerald-300', 'bg-emerald-50', 'text-emerald-800');
      } else if (i === activeStep) {
        card.classList.add('border-rose-400', 'bg-rose-50', 'text-rose-900', 'ring-1', 'ring-rose-300');
      } else {
        card.classList.add('border-slate-200', 'bg-slate-50', 'text-slate-600');
      }
    }
  }

  function appendLog(entry) {
    const line = document.createElement('div');
    let colorClass = 'text-slate-200';
    if (entry.level === 'step') colorClass = 'text-cyan-300 font-semibold';
    else if (entry.level === 'success') colorClass = 'text-emerald-400 font-semibold';
    else if (entry.level === 'warn') colorClass = 'text-amber-300';
    else if (entry.level === 'error') colorClass = 'text-rose-400 font-semibold';

    line.className = `${colorClass} leading-relaxed break-words`;
    line.textContent = `[${entry.ts || '--:--:--'}] ${entry.message}`;
    terminalLog.appendChild(line);
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function loadSystemVersion() {
    try {
      const res = await fetch('/api/system/version', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();

      const shortVer = data.shortVersion || data.version || 'v1.4.0';
      const fullVer = data.version || shortVer;
      const updatedAt = data.updatedAt || '';
      const changelog = Array.isArray(data.changelog) ? data.changelog : [];

      versionBadgeText.textContent = `Phiên bản: ${shortVer}${updatedAt ? ` | Cập nhật: ${updatedAt}` : ''}`;
      modalVersionSub.textContent = fullVer;
      modalUpdatedAt.textContent = updatedAt || '-';
      modalChangelogList.innerHTML =
        changelog.length > 0
          ? changelog.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
          : '<li>Không có ghi chú thay đổi.</li>';

      let prevVersion = null;
      try {
        prevVersion = localStorage.getItem(STORAGE_KEY_VERSION);
        localStorage.setItem(STORAGE_KEY_VERSION, fullVer);
      } catch {
        // Ignore storage errors
      }

      if (prevVersion !== fullVer) {
        updateBannerText.textContent = `✨ Hệ thống vừa nạp bản cập nhật mới (${fullVer}) thành công!`;
        updateBanner.classList.remove('hidden');
      }
    } catch {
      // Ignore version fetch errors
    }
  }

  function openChangelogModal() {
    changelogModal.classList.remove('hidden');
  }

  function closeChangelogModal() {
    changelogModal.classList.add('hidden');
  }

  async function loadDefaults() {
    try {
      const res = await fetch('/api/config/defaults');
      if (!res.ok) return;
      const data = await res.json();
      defaultKeywords = data.keywords || defaultKeywords;
      iterationsInput.value = data.iterations ?? 10;
      targetRawInput.value = data.targetRaw ?? 100;
      minHostsInput.value = data.minHostsPerBuilding ?? 5;
      delayMsInput.value = data.delayMs ?? 3000;
      headlessCheckbox.checked = data.headless ?? true;
      fillDefaultKeywords();
    } catch {
      // Ignore if defaults fail
    }
  }

  function fillDefaultKeywords() {
    kwMandatoryEl.value = (defaultKeywords.mandatory || []).join(', ');
    kwBonusEl.value = (defaultKeywords.bonus || []).join(', ');
    kwExcludedEl.value = (defaultKeywords.excluded || []).join(', ');
  }

  async function loadReports() {
    try {
      const res = await fetch('/api/reports');
      const data = await res.json();
      const files = data.files || [];

      if (files.length === 0) {
        reportsList.innerHTML = '<p class="text-slate-400 italic">Chưa có file Excel nào trong output/.</p>';
        return;
      }

      reportsList.innerHTML = files
        .map((f) => {
          const dateStr = new Date(f.updatedAt).toLocaleString('vi-VN');
          const encoded = encodeURIComponent(f.name);
          return `
            <div class="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition">
              <div class="min-w-0">
                <div class="font-medium text-slate-800 truncate" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
                <div class="text-[11px] text-slate-500">${formatBytes(f.sizeBytes)} • ${escapeHtml(dateStr)}</div>
              </div>
              <a
                href="/api/reports/download/${encoded}"
                download="${escapeHtml(f.name)}"
                class="shrink-0 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
              >
                Tải Excel
              </a>
            </div>
          `;
        })
        .join('');
    } catch (err) {
      reportsList.innerHTML = `<p class="text-rose-500">Lỗi tải danh sách file: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function loadDbPreview(cityOverride = '') {
    try {
      const city = cityOverride || previewCitySelect.value || '';
      const minHosts = parseInt(minHostsInput.value, 10) || 5;
      const params = new URLSearchParams();
      if (city) params.set('city', city);
      params.set('minHosts', String(minHosts));

      const res = await fetch(`/api/db/preview?${params.toString()}`);
      const data = await res.json();

      // Update city dropdown
      const cities = data.cities || [];
      const currentSelected = data.selectedCity || '';
      previewCitySelect.innerHTML =
        cities.length === 0
          ? '<option value="">-- Chưa có dữ liệu --</option>'
          : cities
              .map(
                (c) =>
                  `<option value="${escapeHtml(c)}" ${c === currentSelected ? 'selected' : ''}>${escapeHtml(c)}</option>`
              )
              .join('');

      const summary = data.citySummary;
      if (summary) {
        kpiClean.textContent = summary.cleanCount ?? 0;
        kpiHighRise.textContent = `${summary.highRiseYesCount ?? 0} (${summary.highRisePct ?? 0}%)`;
        kpiBuildings.textContent = `${summary.qualifiedBuildings ?? 0} / ${summary.totalBuildings ?? 0}`;
        kpiAvgPrice.textContent = `$${summary.avgPriceUsd ?? 0}`;
      } else {
        kpiClean.textContent = '-';
        kpiHighRise.textContent = '-';
        kpiBuildings.textContent = '-';
        kpiAvgPrice.textContent = '-';
      }

      // Render Top Buildings
      const buildings = data.topBuildings || [];
      if (buildings.length === 0) {
        buildingsTableBody.innerHTML =
          '<tr><td colspan="6" class="py-6 text-center text-slate-400">Chưa có tòa nhà nào.</td></tr>';
      } else {
        buildingsTableBody.innerHTML = buildings
          .map((b) => {
            const isQualified = b.uniqueHostsCount >= minHosts;
            const badgeCls = isQualified
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : 'bg-slate-100 text-slate-600 border-slate-200';
            const linkHtml = b.bestListingUrl
              ? `<a href="${escapeHtml(b.bestListingUrl)}" target="_blank" rel="noopener" class="text-rose-600 hover:underline font-medium">${escapeHtml(b.buildingName)}</a>`
              : `<span class="font-medium text-slate-800">${escapeHtml(b.buildingName)}</span>`;

            return `
              <tr class="hover:bg-slate-50">
                <td class="py-2 px-2.5 text-slate-500">${b.rank}</td>
                <td class="py-2 px-2.5">
                  ${linkHtml}
                  <div class="text-[11px] text-slate-400 truncate max-w-[200px]">${escapeHtml(b.streetAddress || '')}</div>
                </td>
                <td class="py-2 px-2.5 text-center font-semibold text-slate-800">${b.uniqueHostsCount}</td>
                <td class="py-2 px-2.5 text-center text-slate-700">${b.listingsCount}</td>
                <td class="py-2 px-2.5 text-right font-mono text-slate-800">$${b.avgPrice ?? 0}</td>
                <td class="py-2 px-2.5">
                  <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeCls}">
                    ${escapeHtml(b.status)}
                  </span>
                </td>
              </tr>
            `;
          })
          .join('');
      }

      // Render Listings YES/NO
      const listings = data.recentListings || [];
      if (listings.length === 0) {
        listingsTableBody.innerHTML =
          '<tr><td colspan="5" class="py-6 text-center text-slate-400">Chưa có căn hộ nào.</td></tr>';
      } else {
        listingsTableBody.innerHTML = listings
          .map((l) => {
            const isYes = l.isHighRise === 'YES';
            const badgeCls = isYes
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : 'bg-slate-100 text-slate-600 border-slate-200';
            return `
              <tr class="hover:bg-slate-50">
                <td class="py-2 px-2.5 max-w-[180px] truncate">
                  <a href="${escapeHtml(l.listingUrl)}" target="_blank" rel="noopener" class="text-slate-800 hover:text-rose-600 font-medium" title="${escapeHtml(l.title)}">
                    ${escapeHtml(l.title)}
                  </a>
                </td>
                <td class="py-2 px-2.5 text-slate-600 max-w-[130px] truncate">${escapeHtml(l.buildingName)}</td>
                <td class="py-2 px-2.5 text-center">
                  <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeCls}">
                    ${escapeHtml(l.isHighRise)}
                  </span>
                </td>
                <td class="py-2 px-2.5 text-right font-mono text-slate-800">${l.avgPrice ? `$${l.avgPrice}` : '-'}</td>
                <td class="py-2 px-2.5 text-[11px] text-slate-500 max-w-[180px] truncate" title="${escapeHtml(l.highRiseReason)}">
                  ${escapeHtml(l.highRiseReason)}
                </td>
              </tr>
            `;
          })
          .join('');
      }
      // Render OUT_OF_TARGET Host External Portfolio
      const externalListings = data.outOfTargetListings || [];
      if (externalListings.length === 0) {
        externalTableBody.innerHTML =
          '<tr><td colspan="5" class="py-6 text-center text-slate-400">Chưa có căn hộ ngoài khu vực nào.</td></tr>';
      } else {
        externalTableBody.innerHTML = externalListings
          .map((l) => {
            const locBadge = [l.actualCountry, l.actualCity]
              .filter(Boolean)
              .join(' • ') || 'Ngoài vùng mục tiêu';
            return `
              <tr class="hover:bg-slate-50">
                <td class="py-2 px-2.5 font-medium text-slate-800 max-w-[120px] truncate">${escapeHtml(l.hostName)}</td>
                <td class="py-2 px-2.5 max-w-[180px] truncate">
                  <a href="${escapeHtml(l.listingUrl)}" target="_blank" rel="noopener" class="text-rose-600 hover:underline font-medium" title="${escapeHtml(l.title)}">
                    ${escapeHtml(l.title)}
                  </a>
                </td>
                <td class="py-2 px-2.5">
                  <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                    ${escapeHtml(locBadge)}
                  </span>
                </td>
                <td class="py-2 px-2.5 text-right font-mono text-slate-800">${l.avgPrice ? `$${l.avgPrice}` : '-'}</td>
                <td class="py-2 px-2.5 font-mono text-[11px] text-slate-500">${escapeHtml(l.coordinates || '-')}</td>
              </tr>
            `;
          })
          .join('');
      }
    } catch (err) {
      appendLog({ level: 'error', message: `Lỗi đọc DB preview: ${err.message}` });
    }
  }

  function closeStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function connectJobStream(jobId) {
    closeStream();
    eventSource = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      const pct = Math.min(100, Math.max(0, data.percent || 0));
      progressBar.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}%`;
      progressLabel.textContent = data.stepLabel || '';
      updateStepCards(data.step || 1, pct >= 100);
    });

    eventSource.addEventListener('log', (e) => {
      appendLog(JSON.parse(e.data));
    });

    eventSource.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      updateStepCards(4, true);
      setRunningState(false);
      closeStream();
      loadReports();
      loadDbPreview(data.result?.citySummary?.city || cityInput.value.trim());
    });

    eventSource.addEventListener('stopped', () => {
      progressLabel.textContent = 'Đã dừng tác vụ.';
      setRunningState(false);
      closeStream();
      loadDbPreview();
    });

    eventSource.addEventListener('error', (e) => {
      if (e.data) {
        const data = JSON.parse(e.data);
        progressLabel.textContent = `Lỗi: ${data.error || 'Không xác định'}`;
      }
      setRunningState(false);
      closeStream();
    });
  }

  async function stopCurrentJob() {
    if (!currentJobId) return;
    actionBtn.disabled = true;
    actionBtn.textContent = 'Đang dừng...';
    try {
      await fetch(`/api/jobs/${encodeURIComponent(currentJobId)}/stop`, {
        method: 'POST',
      });
    } catch (err) {
      appendLog({ level: 'error', message: `Không thể dừng tác vụ: ${err.message}` });
    }
  }

  // Event Listeners
  versionBadgeBtn.addEventListener('click', openChangelogModal);
  closeChangelogModalBtn.addEventListener('click', closeChangelogModal);
  okChangelogModalBtn.addEventListener('click', closeChangelogModal);
  changelogModal.addEventListener('click', (e) => {
    if (e.target === changelogModal) closeChangelogModal();
  });
  closeUpdateBannerBtn.addEventListener('click', () => {
    updateBanner.classList.add('hidden');
  });

  countryInput.addEventListener('input', validateGuardrail);

  addExcludedBtn.addEventListener('click', () => {
    addExcludedCountry(excludedCountryInput.value);
  });

  excludedCountryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addExcludedCountry(excludedCountryInput.value);
    }
  });

  excludedTagsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-remove-index]');
    if (!btn) return;
    const idx = parseInt(btn.getAttribute('data-remove-index'), 10);
    removeExcludedCountry(idx);
  });

  resetExcludedBtn.addEventListener('click', () => {
    excludedCountries = [...DEFAULT_EXCLUDED_COUNTRIES];
    saveExcludedCountries();
    renderExcludedTags();
    validateGuardrail();
  });

  toggleAdvancedBtn.addEventListener('click', () => {
    const isHidden = advancedPanel.classList.toggle('hidden');
    advancedArrow.textContent = isHidden ? '▼' : '▲';
  });

  resetKeywordsBtn.addEventListener('click', fillDefaultKeywords);

  clearLogBtn.addEventListener('click', () => {
    terminalLog.innerHTML = '';
  });

  refreshReportsBtn.addEventListener('click', loadReports);
  refreshDbBtn.addEventListener('click', () => loadDbPreview());
  previewCitySelect.addEventListener('change', () => loadDbPreview(previewCitySelect.value));

  function switchPreviewTab(active) {
    const panels = [
      { key: 'buildings', btn: tabBuildingsBtn, panel: tabBuildings },
      { key: 'listings', btn: tabListingsBtn, panel: tabListings },
      { key: 'external', btn: tabExternalBtn, panel: tabExternal },
    ];
    for (const item of panels) {
      const isAct = item.key === active;
      item.panel.classList.toggle('hidden', !isAct);
      item.btn.classList.toggle('border-rose-600', isAct);
      item.btn.classList.toggle('text-rose-600', isAct);
      item.btn.classList.toggle('border-transparent', !isAct);
      item.btn.classList.toggle('text-slate-500', !isAct);
    }
  }

  tabBuildingsBtn.addEventListener('click', () => switchPreviewTab('buildings'));
  tabListingsBtn.addEventListener('click', () => switchPreviewTab('listings'));
  tabExternalBtn.addEventListener('click', () => switchPreviewTab('external'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (isRunning) {
      await stopCurrentJob();
      return;
    }

    if (!validateGuardrail()) return;

    const payload = {
      city: cityInput.value.trim(),
      country: countryInput.value.trim(),
      excludedCountries: [...excludedCountries],
      iterations: parseInt(iterationsInput.value, 10) || 10,
      targetRaw: parseInt(targetRawInput.value, 10) || 100,
      minHostsPerBuilding: parseInt(minHostsInput.value, 10) || 5,
      proxyUrl: proxyUrlInput.value.trim(),
      delayMs: parseInt(delayMsInput.value, 10) || 3000,
      headless: headlessCheckbox.checked,
      exportOnly: exportOnlyCheckbox.checked,
      keywords: {
        mandatory: kwMandatoryEl.value,
        bonus: kwBonusEl.value,
        excluded: kwExcludedEl.value,
      },
    };

    terminalLog.innerHTML = '';
    progressBar.style.width = '2%';
    progressPercent.textContent = '2%';
    progressLabel.textContent = 'Đang gửi yêu cầu khởi chạy...';
    updateStepCards(1, false);
    setRunningState(true);

    try {
      const res = await fetch('/api/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        appendLog({ level: 'error', message: data.error || 'Lỗi khởi tạo tác vụ.' });
        progressLabel.textContent = data.error || 'Lỗi khởi tạo.';
        setRunningState(false);
        return;
      }

      currentJobId = data.jobId;
      connectJobStream(currentJobId);
    } catch (err) {
      appendLog({ level: 'error', message: `Lỗi kết nối server: ${err.message}` });
      setRunningState(false);
    }
  });

  // Initial Boot
  renderExcludedTags();
  validateGuardrail();
  loadSystemVersion();
  loadDefaults();
  loadReports();
  loadDbPreview();
})();
