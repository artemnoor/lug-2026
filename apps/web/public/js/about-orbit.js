// ==========================================================================
// АНИМАЦИЯ ХОЛСТА (НАПРАВЛЕНИЕ «КУЛЬТУРА И ТВОРЧЕСТВО»)
// ==========================================================================
(function() {
  window.startCultureCanvas = function() {
    const animSvg = document.getElementById('livelyArtworkAnimation');
    if (!animSvg) return;
    try { animSvg.pauseAnimations?.(); } catch(e){}
    try { animSvg.setCurrentTime?.(0); } catch(e){}
    try { animSvg.unpauseAnimations?.(); } catch(e){}
  };

  window.stopCultureCanvas = function() {
    const animSvg = document.getElementById('livelyArtworkAnimation');
    if (!animSvg) return;
    try { animSvg.pauseAnimations?.(); } catch(e){}
  };
})();

// ==========================================================================
    // ИНТЕРАКТИВНЫЙ ОРБИТАЛЬНЫЙ ВИДЖЕТ НАПРАВЛЕНИЙ («О КОНКУРСЕ»)
    // ==========================================================================
    (function initAboutOrbit(){
      const data = {
        science: {
          index: '01',
          title: 'НАУЧНАЯ<br>ДЕЯТЕЛЬНОСТЬ',
          description: 'Научный трек оценивает исследовательские достижения студентов группы за учебный год. Баллы начисляются за публикации в рецензируемых журналах (ВАК, РИНЦ, Scopus, WoS), очные доклады на научно-технических конференциях, зарегистрированные патенты и свидетельства на ПО, выигранные гранты (РНФ, УМНИК) и победы в профильных инженерных хакатонах.',
          tags: ['Публикации ВАК / РИНЦ / Scopus', 'Конференции и доклады', 'Патенты и свидетельства на ПО', 'Гранты РНФ и УМНИК', 'Инженерные хакатоны'],
          accent: '#006CDC',
          soft: '#DCEEFF',
          glow: 'transparent'
        },
        public: {
          index: '02',
          title: 'ОБЩЕСТВЕННАЯ<br>ДЕЯТЕЛЬНОСТЬ',
          description: 'Вклад команды в жизнь университета и города. Учитываются волонтёрские инициативы, студенческие медиа, организация факультетских событий и проекты, которые делают университетскую среду живее и добрее.',
          tags: ['Волонтёрские инициативы', 'Студенческие медиа', 'Факультетские события', 'Социальные проекты', 'Инициативы команды'],
          accent: '#5E4EDB',
          soft: '#ECE9FD',
          glow: 'transparent'
        },
        sport: {
          index: '03',
          title: 'СПОРТИВНАЯ<br>ДЕЯТЕЛЬНОСТЬ',
          description: 'Спортивный потенциал и командная сплочённость бауманцев. В зачёт идут результаты участия в Спартакиаде МГТУ между факультетами, выступления за сборные команды университета, призовые места на Московских студенческих спортивных играх (МССИ), сдача нормативов ГТО на золотые знаки отличия и подтвержденные спортивные разряды.',
          tags: ['Спартакиада МГТУ', 'Сборные команды университета', 'Игры МССИ и Универсиады', 'Золотые знаки ГТО', 'Спортивные разряды'],
          accent: '#D9384C',
          soft: '#FDE8EB',
          glow: 'transparent'
        },
        culture: {
          index: '04',
          title: 'КУЛЬТУРА И<br>ТВОРЧЕСТВО',
          description: 'Творческое самовыражение и общественная активность студентов. Направление учитывает участие и победы в фестивале «Студенческая весна», выступления в творческих клубах ДК МГТУ, развитие студенческих медиа-ресурсов, волонтёрскую деятельность, организацию факультетских событий и личный вклад в яркую жизнь университета.',
          tags: ['Фестиваль «Студвесна»', 'Творческие клубы ДК', 'Студенческие медиа и дизайн', 'Волонтёрский корпус МГТУ', 'Культурные проекты'],
          accent: '#C86E18',
          soft: '#FEF0D8',
          glow: 'transparent'
        }
      };

      const order = ['science', 'public', 'sport', 'culture'];
      cacheFullTexts();
      const stage = document.getElementById('orbitStage');
      if(!stage) return;

      // The old public-activity SVG is kept in the source as a fallback, but
      // it is too heavy to keep mounted next to the optimized raster artwork.
      stage.querySelector('[data-illustration="public-legacy"]')?.remove();

      const copyBlock = document.getElementById('orbitCopyBlock');
      const copyKickerText = document.getElementById('orbitCopyKickerText') || document.getElementById('orbitCopyKicker');
      const copyTitle = document.getElementById('orbitCopyTitle');
      const copyDescription = document.getElementById('orbitCopyDescription');
      const copyTags = document.getElementById('orbitCopyTags');
      const art = document.getElementById('orbitArt');
      const artIllustrations = [...stage.querySelectorAll('[data-illustration]')];
      const orbitNodes = [...stage.querySelectorAll('.orbit-node')];

      let active = 'science';
      let swapTimer = 0;

      function updateContent(id, animate = true) {
        const item = data[id];
        if (!item) return;

        stage.style.setProperty('--orbit-accent', item.accent);
        stage.style.setProperty('--orbit-accent-soft', item.soft);
        stage.style.setProperty('--orbit-accent-glow', item.glow);
        stage.dataset.orbitId = id;
        orbitNodes.forEach(node => {
          const isActive = node.dataset.id === id;
          node.setAttribute('aria-pressed', String(isActive));
          node.tabIndex = isActive ? 0 : -1;
        });
        active = id;

        clearTimeout(swapTimer);

        const microscopeSvg = document.getElementById('microscopeSvg');

        const commit = () => {
          if(copyKickerText) copyKickerText.textContent = `Направление ${item.index}`;
          if(copyTitle) copyTitle.innerHTML = item.title;
          if(copyDescription) copyDescription.textContent = item.description;
          if(copyTags && item.tags) {
            copyTags.innerHTML = item.tags.map(tag => `<span class="orbit-tag">${tag}</span>`).join('');
          }
          
          if (id === 'science') {
            if (microscopeSvg) microscopeSvg.style.display = 'block';
          } else {
            if (microscopeSvg) microscopeSvg.style.display = 'none';
          }
          artIllustrations.forEach(illustration => {
            illustration.style.display = illustration.dataset.illustration === id ? 'block' : 'none';
          });

          if (id === 'culture') {
            window.startCultureCanvas?.();
          } else {
            window.stopCultureCanvas?.();
          }

          if (id === 'public') {
            if (!notebookHasPlayed) {
              startNotebookAutoPlay();
            } else {
              setNotebookComplete();
            }
          } else {
            if (notebookIsRunning) {
              notebookCancelToken++;
              notebookIsRunning = false;
              notebookHasPlayed = true;
            }
            if (notebookHasPlayed) {
              setNotebookComplete();
            } else {
              resetNotebook();
            }
          }

          copyBlock?.classList.remove('is-leaving');
          art?.classList.remove('is-leaving');

          if (animate) {
            copyBlock?.classList.add('is-entering');
            art?.classList.add('is-entering');

            setTimeout(() => {
              copyBlock?.classList.remove('is-entering');
              art?.classList.remove('is-entering');
            }, 500);
          }
        };

        if (!animate) {
          commit();
          return;
        }

        copyBlock?.classList.add('is-leaving');
        art?.classList.add('is-leaving');
        swapTimer = setTimeout(commit, 180);
      }

      // Auto-running notebook solution for the public-activity illustration.
      let notebookCancelToken = 0;
      let notebookIsRunning = false;
      let notebookHasPlayed = false;

      function cacheFullTexts() {
        const svg = document.getElementById('publicActivityIllustrationSvg');
        if (!svg) return;
        svg.querySelectorAll('.hand').forEach(el => {
          if (!el.dataset.fullText) {
            const txt = el.textContent.trim();
            if (txt) el.dataset.fullText = txt;
          }
        });
      }

      function resetNotebook() {
        const svg = document.getElementById('publicActivityIllustrationSvg');
        if (!svg) return;

        svg.querySelectorAll('*').forEach(el => {
          if (typeof el.getAnimations === 'function') {
            el.getAnimations().forEach(anim => anim.cancel());
          }
        });

        cacheFullTexts();

        svg.querySelectorAll('.hand').forEach(el => {
          el.textContent = '';
          el.style.opacity = '0';
          el.style.transform = 'none';
        });

        svg.querySelectorAll('.ink').forEach(el => {
          let len = 120;
          try {
            if (typeof el.getTotalLength === 'function') {
              len = Math.ceil(el.getTotalLength()) + 25;
            }
          } catch(e) {}
          el.style.opacity = '0';
          el.style.strokeDasharray = String(len);
          el.style.strokeDashoffset = String(len);
        });
      }

      function setNotebookComplete() {
        const svg = document.getElementById('publicActivityIllustrationSvg');
        if (!svg) return;

        svg.querySelectorAll('*').forEach(el => {
          if (typeof el.getAnimations === 'function') {
            el.getAnimations().forEach(anim => anim.cancel());
          }
        });

        cacheFullTexts();

        svg.querySelectorAll('.hand').forEach(el => {
          if (el.dataset.fullText) {
            el.textContent = el.dataset.fullText;
          }
          el.style.opacity = '1';
          el.style.transform = 'none';
        });

        svg.querySelectorAll('.ink').forEach(el => {
          el.style.opacity = '1';
          el.style.strokeDashoffset = '0';
        });
      }

      async function playNotebookSequence(token) {
        if (notebookIsRunning) return;
        notebookIsRunning = true;
        
        const svg = document.getElementById('publicActivityIllustrationSvg');
        if (!svg) { notebookIsRunning = false; return; }

        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const clamp = (v,a,b) => Math.max(a, Math.min(b,v));

        const write = async (id, factor=1) => {
          if (token !== notebookCancelToken || active !== 'public') return;
          const el = svg.querySelector('#' + id);
          if(!el) return;
          const full = el.dataset.fullText || el.textContent.trim();
          el.dataset.fullText = full;
          el.textContent = '';
          el.style.opacity = '1';
          const stepDelay = Math.max(10, Math.min(26, Math.round(16 * factor)));
          for (let i = 1; i <= full.length; i++) {
            if (token !== notebookCancelToken || active !== 'public') return;
            el.textContent = full.slice(0, i);
            await sleep(stepDelay);
          }
          await sleep(35);
        };

        const draw = async (id, factor=1) => {
          if (token !== notebookCancelToken || active !== 'public') return;
          const el = svg.querySelector('#' + id);
          if(!el) return;
          let len = 120;
          try{
            if (typeof el.getTotalLength === 'function') {
              len = Math.max(20, Math.ceil(el.getTotalLength()) + 25);
            }
          }catch(e){}
          el.style.opacity = '1';
          el.style.strokeDasharray = String(len);
          el.style.strokeDashoffset = String(len);
          const duration = clamp(len * 2.2 * factor, 200, 1000);
          const anim = el.animate(
            [
              {strokeDashoffset: len, opacity: 1},
              {strokeDashoffset: 0, opacity: 1}
            ],
            {duration, easing: 'cubic-bezier(.35,.05,.2,1)'}
          );
          await anim.finished.catch(()=>{});
          if (token !== notebookCancelToken || active !== 'public') return;
          el.style.opacity = '1';
          el.style.strokeDashoffset = '0';
          await sleep(35);
        };

        const pause = async (ms=200) => {
          if (token !== notebookCancelToken || active !== 'public') return;
          await sleep(ms);
        };

        resetNotebook();
        await pause(300);

        // Sequence
        await write('edu-l-title',.9); await draw('edu-l-title-u',.8);
        await write('edu-l-g1'); await write('edu-l-g2'); await write('edu-l-g3'); await pause(240);
        await draw('edu-beam',1.1); await draw('edu-supportA'); await draw('edu-supportB'); await write('edu-A',.7); await write('edu-B',.7);
        await draw('edu-qtop',.8); await draw('edu-qarrows',1.15); await write('edu-qtext',.8);
        await draw('edu-parrow',.8); await write('edu-ptext',.8);
        await draw('edu-reactA',.7); await write('edu-ratext',.7); await draw('edu-reactB',.7); await write('edu-rbtext',.7);
        await draw('edu-dims',.9); await write('edu-d1',.7); await write('edu-d2',.7); await write('edu-d3',.7); await pause(300);

        await write('edu-r-title',.9); await write('edu-r1'); await write('edu-r2'); await write('edu-r3'); await write('edu-r4'); await draw('edu-r-u',.9); await pause(350);

        await write('edu-q-title',.9); await write('edu-qe1',.9); await write('edu-qe2',.9); await write('edu-qe3',.9);
        await draw('edu-qaxes',1.0); await write('edu-qlabel',.7); await write('edu-qx',.7); await draw('edu-qgraph',1.35); await draw('edu-qhatch',1.15);
        await write('edu-q20',.7); await write('edu-q4',.7); await write('edu-qm16',.7);
        await write('edu-qnote',.85); await write('edu-qnote2',.85); await write('edu-qnote3',.85); await write('edu-qnote4',.85); await pause(380);

        await write('edu-m-title',.9); await write('edu-me1'); await write('edu-me2'); await write('edu-me3');
        await draw('edu-maxes',1.0); await write('edu-mlabel',.7); await write('edu-mx',.7); await draw('edu-mgraph',1.55); await draw('edu-mguide',.9); await write('edu-m32',.7); await write('edu-mmax'); await draw('edu-m-u',.9); await pause(350);

        await write('edu-s-title',.9); await draw('edu-section',1.1); await draw('edu-sectiondim',.9); await write('edu-h120',.8); await write('edu-b60',.8);
        await write('edu-w1'); await write('edu-w2'); await write('edu-w3'); await pause(260);
        await write('edu-str-title',.9); await write('edu-str1'); await write('edu-str2'); await write('edu-str3'); await draw('edu-str-u',1.0); await pause(220); await write('edu-final',.95);

        notebookHasPlayed = true;
        notebookIsRunning = false;
        setNotebookComplete();
      }

      function startNotebookAutoPlay() {
        if (notebookHasPlayed) {
          setNotebookComplete();
          return;
        }
        notebookCancelToken++;
        notebookIsRunning = false;
        cacheFullTexts();
        resetNotebook();
        const currentToken = notebookCancelToken;
        playNotebookSequence(currentToken);
      }

      // Microscope nosepiece rotation animation
      const assembly = document.getElementById("nosepieceAssembly");
      const objectives = [
        document.getElementById("objective1"),
        document.getElementById("objective2"),
        document.getElementById("objective3")
      ];

      const radiusX = 24;
      const radiusY = 6.2;
      let microscopeRotation = 0;

      function renderMicroscope(angle, switchProgress = 0) {
        if (!assembly || !objectives[0]) return;
        // The animation can resume after a tab swap while an old animation
        // frame is still queued. Keep the SVG transform valid in that case.
        const safeAngle = Number.isFinite(angle)
          ? angle
          : (Number.isFinite(microscopeRotation) ? microscopeRotation : 0);
        const safeProgress = Number.isFinite(switchProgress)
          ? Math.min(1, Math.max(0, switchProgress))
          : 0;
        const push = Math.pow(Math.max(0, Math.sin(Math.PI * safeProgress)), 1.35);
        const extendX = push * 0.8;
        const extendY = push * 5.2;

        assembly.setAttribute(
          "transform",
          `translate(${extendX.toFixed(3)} ${extendY.toFixed(3)})`
        );

        objectives.forEach((objective, index) => {
          if (!objective) return;
          const phase = (index * 120 + safeAngle) * Math.PI / 180;
          const x = Math.sin(phase) * radiusX;
          const y = -radiusY * (1 - Math.cos(phase));
          const depth = (Math.cos(phase) + 1) / 2;
          const scale = 0.955 + depth * 0.05;

          objective.setAttribute(
            "transform",
            `translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(4)})`
          );
        });
      }

      function easeInOutCubic(t) {
        return t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function switchObjective() {
        if (active !== 'science') {
          setTimeout(switchObjective, 1500);
          return;
        }
        const startRotation = microscopeRotation;
        const targetRotation = microscopeRotation + 120;
        const duration = 700;
        const startTime = performance.now();

        function animate(now) {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const eased = easeInOutCubic(progress);

          const angle = startRotation + (targetRotation - startRotation) * eased;
          renderMicroscope(angle, eased);

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            microscopeRotation = targetRotation % 360;
            renderMicroscope(microscopeRotation, 0);
            setTimeout(switchObjective, 1700);
          }
        }

        requestAnimationFrame(animate);
      }

      renderMicroscope(microscopeRotation, 0);
      setTimeout(switchObjective, 1400);

      function shift(step) {
        const currentIndex = order.indexOf(active);
        const nextIndex = (currentIndex + step + order.length) % order.length;
        updateContent(order[nextIndex]);
      }

      orbitNodes.forEach(node => {
        node.addEventListener('click', () => updateContent(node.dataset.id));
        node.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
          const currentNodeIndex = order.indexOf(active);
          const nextNodeIndex = (currentNodeIndex + direction + order.length) % order.length;
          const nextNode = orbitNodes[nextNodeIndex];
          updateContent(order[nextNodeIndex]);
          nextNode?.focus();
        });
      });

      document.addEventListener('keydown', event => {
        if (event.target.closest?.('.orbit-node-list')) return;
        const aboutSec = document.querySelector('.stage-about');
        if (!aboutSec) return;
        const rect = aboutSec.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.5 && rect.bottom > window.innerHeight * 0.5) {
          if (event.key === 'ArrowLeft') shift(-1);
          if (event.key === 'ArrowRight') shift(1);
        }
      });

      updateContent('science', false);
    })();
