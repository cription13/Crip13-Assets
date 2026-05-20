const navbar = document.getElementById('siteHeader');
const hamburger = document.querySelector('.hamburger');
const mobileMenu = document.getElementById('mobileMenu');
const hero = document.getElementById('hero');
const floatingBadges = document.querySelectorAll('.float-badge');
const timeline = document.getElementById('timeline');
const contactForm = document.getElementById('contactForm');
const successMessage = document.getElementById('formSuccess');

const setNavbarState = () => {
  if (navbar) {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  }
};

window.addEventListener('scroll', setNavbarState, { passive: true });
setNavbarState();

const closeMobileMenu = () => {
  if (!mobileMenu || !hamburger) {
    return;
  }

  mobileMenu.classList.remove('open');
  hamburger.classList.remove('open');
  hamburger.setAttribute('aria-expanded', 'false');
  mobileMenu.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('menu-open');
};

if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    hamburger.classList.toggle('open', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
    mobileMenu.setAttribute('aria-hidden', String(!isOpen));
    document.body.classList.toggle('menu-open', isOpen);
  });
}

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (event) => {
    const targetId = anchor.getAttribute('href');
    const target = document.querySelector(targetId);

    if (!target) {
      return;
    }

    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    closeMobileMenu();
  });
});

const animationObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const delay = entry.target.dataset.delay || 0;
      entry.target.style.setProperty('--delay', `${delay}ms`);
      entry.target.classList.add('animate-visible');
      animationObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.animate-hidden').forEach((element) => {
  animationObserver.observe(element);
});

const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);

const animateCounter = (counter) => {
  const target = Number(counter.dataset.target);
  const suffix = counter.dataset.suffix || '';
  const duration = 1500;
  const start = performance.now();

  const tick = (now) => {
    const elapsed = Math.min((now - start) / duration, 1);
    const value = Math.round(easeOutCubic(elapsed) * target);

    counter.textContent = `${value}${suffix}`;

    if (elapsed < 1) {
      requestAnimationFrame(tick);
    }
  };

  requestAnimationFrame(tick);
};

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.counter').forEach(animateCounter);
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.35 });

const statsSection = document.getElementById('stats');
if (statsSection) {
  statsObserver.observe(statsSection);
}

const navLinks = document.querySelectorAll('.nav-links a');
const sectionIds = Array.from(navLinks)
  .map((link) => link.getAttribute('href'))
  .filter((href) => href && href.startsWith('#'));

const activeNavObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      navLinks.forEach((link) => {
        link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`);
      });
    }
  });
}, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });

sectionIds.forEach((id) => {
  const section = document.querySelector(id);
  if (section) {
    activeNavObserver.observe(section);
  }
});

const updateTimelineProgress = () => {
  if (!timeline) {
    return;
  }

  const rect = timeline.getBoundingClientRect();
  const viewportMid = window.innerHeight * 0.65;
  const progress = Math.min(Math.max((viewportMid - rect.top) / rect.height, 0), 1);

  timeline.style.setProperty('--progress', `${progress * 100}%`);
};

window.addEventListener('scroll', updateTimelineProgress, { passive: true });
window.addEventListener('resize', updateTimelineProgress);
updateTimelineProgress();

const showFieldError = (field, message) => {
  const existing = field.parentElement.querySelector('.field-error');

  if (existing) {
    existing.remove();
  }

  const error = document.createElement('span');
  error.className = 'field-error';
  error.textContent = message;
  field.insertAdjacentElement('afterend', error);
};

const clearFieldError = (field) => {
  const existing = field.parentElement.querySelector('.field-error');

  if (existing) {
    existing.remove();
  }
};

if (contactForm && successMessage) {
  contactForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let isValid = true;

    contactForm.querySelectorAll('[required]').forEach((field) => {
      const value = field.value.trim();
      clearFieldError(field);

      if (!value) {
        isValid = false;
        showFieldError(field, 'This field is required.');
        return;
      }

      if (field.type === 'email' && !field.validity.valid) {
        isValid = false;
        showFieldError(field, 'Enter a valid email address.');
      }
    });

    if (!isValid) {
      successMessage.classList.remove('show');
      return;
    }

    contactForm.reset();
    successMessage.classList.add('show');
  });

  contactForm.querySelectorAll('input, select, textarea').forEach((field) => {
    field.addEventListener('input', () => clearFieldError(field));
  });
}

let rafId = null;
let mouseX = 0;
let mouseY = 0;

const updateBadgeParallax = () => {
  const rect = hero.getBoundingClientRect();
  const x = ((mouseX - rect.left) / rect.width - 0.5) * -10;
  const y = ((mouseY - rect.top) / rect.height - 0.5) * -10;

  floatingBadges.forEach((badge) => {
    const depth = Number(badge.dataset.depth || 1);
    badge.style.transform = `translate3d(${x * depth}px, ${y * depth}px, 0)`;
  });

  rafId = null;
};

if (hero && floatingBadges.length) {
  hero.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;

    if (!rafId) {
      rafId = requestAnimationFrame(updateBadgeParallax);
    }
  });

  hero.addEventListener('mouseleave', () => {
    floatingBadges.forEach((badge) => {
      badge.style.transform = '';
    });
  });
}
