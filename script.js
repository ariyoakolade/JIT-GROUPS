const companyConfig = [
  {
    id: 'consulting',
    name: 'JIT Empirical Global Consult',
    description: 'International business consulting, immigration advisory, recruitment and business development.',
    image: 'image/consulting-office.jpg',
    alt: 'An empty, modern office meeting room with a long table and chairs.',
    url: 'https://jitglobalconsult.com/'
  },
  {
    id: 'travel',
    name: 'JIT Travels',
    description: 'Travel services, international relocation, tours and event experiences abroad.',
    image: 'image/travel-aircraft.jpg',
    alt: 'An airplane wing above the clouds at sunset.',
    url: 'https://jitglobalconsult.com/immigration-consultation/'
  },
  {
    id: 'real-estate',
    name: 'HelloHomes',
    description: 'Real estate opportunities, property services and housing solutions.',
    image: 'image/real-estate.jpg',
    alt: 'A modern residential interior with an open-plan living area.',
    url: 'https://www.hellohomes.com/'
  },
  {
    id: 'radio',
    name: 'HelloRadio',
    description: 'An online radio platform connecting audiences through digital broadcasting, conversations and audio content.',
    image: 'image/radio-studio.jpg',
    alt: 'Audio mixing equipment and instruments in a recording studio.',
    url: 'https://www.helloradiotv.com/'
  }
];

const renderCompanyCards = () => {
  const grid = document.querySelector('#company-grid');
  if (!grid) return;

  grid.innerHTML = companyConfig.map((company) => {
    return `
      <article class="company-card" id="company-${company.id}" aria-label="${company.name}">
        <div class="company-card-media">
          <img src="${company.image}" alt="${company.alt}" loading="lazy" />
        </div>
        <div class="company-card-content">
          <h3>${company.name}</h3>
          <div class="rule" aria-hidden="true"></div>
          <p>${company.description}</p>
          <a class="company-link" href="${company.url}" target="_blank" rel="noopener noreferrer">Visit Website</a>
        </div>
      </article>
    `;
  }).join('');
};

const setHeaderState = () => {
  const header = document.querySelector('.site-header');
  if (!header) return;

  if (window.scrollY > 24) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
};

const bindMobileNavigation = () => {
  const nav = document.querySelector('.main-nav');
  const menuToggle = document.querySelector('.menu-toggle');
  const dropdown = document.querySelector('.nav-item.dropdown');
  const dropdownToggle = document.querySelector('.dropdown-toggle');

  if (!nav || !menuToggle) return;

  const closeMenu = () => {
    nav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    if (dropdown) {
      dropdown.classList.remove('open');
    }
    if (dropdownToggle) {
      dropdownToggle.setAttribute('aria-expanded', 'false');
    }
  };

  menuToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target) && !menuToggle.contains(event.target)) {
      closeMenu();
    }
  });

  if (dropdown && dropdownToggle) {
    dropdownToggle.addEventListener('click', (event) => {
      if (window.innerWidth <= 990) {
        event.preventDefault();
        const open = dropdown.classList.toggle('open');
        dropdownToggle.setAttribute('aria-expanded', String(open));
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  });
};

const bindDropdownDesktop = () => {
  const dropdown = document.querySelector('.nav-item.dropdown');
  const dropdownToggle = document.querySelector('.dropdown-toggle');

  if (!dropdown || !dropdownToggle || window.innerWidth <= 990) return;

  dropdown.addEventListener('mouseenter', () => {
    dropdown.classList.add('open');
    dropdownToggle.setAttribute('aria-expanded', 'true');
  });

  dropdown.addEventListener('mouseleave', () => {
    dropdown.classList.remove('open');
    dropdownToggle.setAttribute('aria-expanded', 'false');
  });

  dropdownToggle.addEventListener('click', (event) => {
    event.preventDefault();
    const isOpen = dropdown.classList.toggle('open');
    dropdownToggle.setAttribute('aria-expanded', String(isOpen));
  });

  dropdownToggle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      dropdown.classList.remove('open');
      dropdownToggle.setAttribute('aria-expanded', 'false');
      dropdownToggle.blur();
    }
  });
};

const addBrandFallback = () => {
  const logo = document.querySelector('.brand-logo');
  const wordmark = document.querySelector('.brand-wordmark');

  if (!logo || !wordmark) return;

  logo.addEventListener('error', () => {
    logo.style.display = 'none';
    wordmark.style.display = 'block';
  });
};

const bindHomeGallery = () => {
  const track = document.querySelector('#home-gallery-track');
  const previous = document.querySelector('[data-gallery-prev]');
  const next = document.querySelector('[data-gallery-next]');
  const lightbox = document.querySelector('.gallery-lightbox');
  const lightboxImage = document.querySelector('.gallery-lightbox-image');
  const lightboxCaption = document.querySelector('.gallery-lightbox-caption');
  const lightboxClose = document.querySelector('.gallery-lightbox-close');

  if (!track) return;

  const scrollGallery = (direction) => {
    const slide = track.querySelector('.home-gallery-slide');
    if (!slide) return;

    const gap = Number.parseFloat(window.getComputedStyle(track).gap) || 0;
    track.scrollBy({
      left: direction * (slide.getBoundingClientRect().width + gap),
      behavior: 'smooth'
    });
  };

  if (previous && next) {
    previous.addEventListener('click', () => scrollGallery(-1));
    next.addEventListener('click', () => scrollGallery(1));
  }

  if (lightbox && lightboxImage && lightboxCaption && lightboxClose) {
    track.querySelectorAll('.gallery-image-button').forEach((button) => {
      button.addEventListener('click', () => {
        const image = button.querySelector('img');
        const caption = button.closest('.home-gallery-slide')?.querySelector('figcaption');
        if (!image) return;

        lightboxImage.src = image.currentSrc || image.src;
        lightboxImage.alt = image.alt;
        lightboxCaption.textContent = caption?.textContent.trim() || image.alt;
        lightbox.showModal();
      });
    });

    lightboxClose.addEventListener('click', () => lightbox.close());
    lightbox.addEventListener('click', (event) => {
      if (event.target === lightbox) lightbox.close();
    });
  }
};

const bindTeam1000EventCarousel = () => {
  const track = document.querySelector('#team1000-event-track');
  const previous = document.querySelector('[data-team1000-event-prev]');
  const next = document.querySelector('[data-team1000-event-next]');

  if (!track) return;

  const scrollCarousel = (direction) => {
    const slide = track.querySelector('.team1000-event-slide');
    if (!slide) return;

    const gap = Number.parseFloat(window.getComputedStyle(track).gap) || 0;
    track.scrollBy({
      left: direction * (slide.getBoundingClientRect().width + gap),
      behavior: 'smooth'
    });
  };

  previous?.addEventListener('click', () => scrollCarousel(-1));
  next?.addEventListener('click', () => scrollCarousel(1));
};

const bindRegistrationDialog = (dialogSelector, openButtonSelector) => {
  const dialog = document.querySelector(dialogSelector);
  const frame = dialog?.querySelector('.team1000-form-frame');
  const close = dialog?.querySelector('.team1000-form-close');

  if (!dialog || !frame || !close) return;

  document.querySelectorAll(openButtonSelector).forEach((button) => {
    button.addEventListener('click', () => {
      if (!frame.src) frame.src = frame.dataset.src;
      dialog.showModal();
      close.focus();
    });
  });

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
};

document.addEventListener('DOMContentLoaded', () => {
  renderCompanyCards();
  const year = document.querySelector('#current-year');
  if (year) year.textContent = String(new Date().getFullYear());
  setHeaderState();
  addBrandFallback();
  bindHomeGallery();
  bindTeam1000EventCarousel();
  bindRegistrationDialog('.team1000-form-dialog:not(.team1000-event-dialog)', '[data-open-team1000-form]');
  bindRegistrationDialog('.team1000-event-dialog', '[data-open-team1000-event-form]');
  bindDropdownDesktop();
  bindMobileNavigation();
});

window.addEventListener('scroll', setHeaderState);
window.addEventListener('resize', () => {
  const nav = document.querySelector('.main-nav');
  const menuToggle = document.querySelector('.menu-toggle');
  if (window.innerWidth > 990) {
    if (nav) nav.classList.remove('is-open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  }
  bindDropdownDesktop();
});
