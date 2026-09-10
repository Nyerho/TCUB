const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/', (req, res) => {
  if (req.session.userId) {
    if (req.session.user && req.session.user.is_admin === 1) {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/user/dashboard');
  }

  const stats = {
    customers: db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 0').get().count,
    accounts: db.prepare('SELECT COUNT(*) as count FROM accounts').get().count,
    branches: 58,
    years: 42
  };

  res.render('index', {
    title: 'Think Union Credit Bank - Georgia Credit Union Banking',
    page: 'home',
    stats
  });
});

router.get('/about', (req, res) => {
  res.render('about', {
    title: 'About Us - Think Union Credit Bank',
    page: 'about'
  });
});

router.get('/contact', (req, res) => {
  res.render('contact', {
    title: 'Contact Us - Think Union Credit Bank',
    page: 'contact'
  });
});

router.get('/services', (req, res) => {
  res.render('services', {
    title: 'Our Services - Think Union Credit Bank',
    page: 'services'
  });
});

router.post('/contact', (req, res) => {
  req.session.success = 'Thank you for your message! Our team will contact you within 24 hours.';
  res.redirect('/contact');
});

module.exports = router;
