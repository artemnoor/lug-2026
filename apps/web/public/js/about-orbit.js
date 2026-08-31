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
      const stage = document.getElementById('orbitStage');
      if(!stage) return;

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
          
          if (microscopeSvg) microscopeSvg.hidden = id !== 'science';
          artIllustrations.forEach(illustration => {
            illustration.hidden = illustration.dataset.illustration !== id;
          });

          if (id === 'culture') {
            window.startCultureCanvas?.();
          } else {
            window.stopCultureCanvas?.();
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
