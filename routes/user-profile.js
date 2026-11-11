'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/guards');
const userAccountStore = require('../services/user-account-store');
const firestore = require('../services/firestore-rest');

const router = express.Router();

function hasTransferPin(user) {
  return Boolean(user && user.transfer_pin_hash);
}

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await userAccountStore.getUserById(req.session.userId);
    if (!user) {
      req.session.error = 'Your profile could not be found.';
      return res.redirect('/auth/login');
    }
    return res.render('user/profile', {
      title: 'My Profile - Think Union Credit Bank',
      page: 'profile',
      user
    });
  } catch (error) {
    console.error('[user-profile] Firestore profile read failed:', error.message);
    req.session.error = 'Unable to load your profile right now.';
    return res.redirect('/user/dashboard');
  }
});

router.post('/profile', requireAuth, [
  body('first_name').trim().isLength({ min: 2 }),
  body('last_name').trim().isLength({ min: 2 }),
  body('phone').isLength({ min: 6 }),
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Please check your input and try again.';
    return res.redirect('/user/profile');
  }

  const { first_name, last_name, email, phone, address, city, state, postcode, date_of_birth } = req.body;
  const userId = req.session.userId;
  let currentUser = null;
  let authEmailUpdated = false;
  try {
    currentUser = await userAccountStore.getUserById(userId);
    if (!currentUser) {
      req.session.error = 'Your profile could not be found.';
      return res.redirect('/user/profile');
    }
    const existingUsers = await userAccountStore.findUsersByEmail(email);
    if (existingUsers.some((user) => String(user.id) !== String(userId))) {
      req.session.error = 'This email is already in use.';
      return res.redirect('/user/profile');
    }

    if (String(currentUser.email || '').trim().toLowerCase() !== email) {
      const authUpdate = await firestore.updateFirebaseAuthUserByEmail(currentUser.email, { email });
      authEmailUpdated = authUpdate.updated;
    }

    const updated = await userAccountStore.updateUser(userId, {
      first_name,
      last_name,
      email,
      phone,
      address: address || '',
      city: city || '',
      state: state || '',
      postcode: postcode || '',
      date_of_birth: date_of_birth || '',
      updated_at: new Date().toISOString()
    });
    if (!updated) throw new Error('Firestore profile disappeared during the update.');
    if (req.session.user) {
      req.session.user.first_name = first_name;
      req.session.user.last_name = last_name;
      req.session.user.email = email;
    }
    req.session.success = 'Profile updated successfully.';
    return res.redirect('/user/profile');
  } catch (error) {
    if (authEmailUpdated && currentUser && currentUser.email) {
      try {
        await firestore.updateFirebaseAuthUserByEmail(email, { email: currentUser.email });
      } catch (rollbackError) {
        console.error('[user-profile] Firebase Auth email rollback failed:', rollbackError.message);
      }
    }
    if (error.code === 'EMAIL_ALREADY_IN_USE') {
      req.session.error = 'This email is already in use.';
      return res.redirect('/user/profile');
    }
    console.error('[user-profile] Firestore profile update failed:', error.message);
    req.session.error = 'Unable to update your profile right now.';
    return res.redirect('/user/profile');
  }
});

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const user = await userAccountStore.getUserById(req.session.userId);
    if (!user) {
      req.session.error = 'Your profile could not be found.';
      return res.redirect('/auth/login');
    }
    return res.render('user/settings', {
      title: 'Settings - Think Union Credit Bank',
      page: 'settings',
      user,
      hasTransferPin: hasTransferPin(user)
    });
  } catch (error) {
    console.error('[user-profile] Firestore settings read failed:', error.message);
    req.session.error = 'Unable to load settings right now.';
    return res.redirect('/user/dashboard');
  }
});

router.post('/change-password', requireAuth, [
  body('current_password').exists(),
  body('new_password').isLength({ min: 8 }),
  body('confirm_password').custom((value, { req }) => value === req.body.new_password)
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Password must be at least 8 characters and match confirmation.';
    return res.redirect('/user/settings');
  }

  const { current_password, new_password } = req.body;
  try {
    const user = await userAccountStore.getUserById(req.session.userId);
    if (!user || !user.password) {
      req.session.error = 'Your profile could not be found.';
      return res.redirect('/user/settings');
    }
    const isValid = await bcrypt.compare(current_password, user.password);
    if (!isValid) {
      req.session.error = 'Current password is incorrect.';
      return res.redirect('/user/settings');
    }
    const hashedPassword = await bcrypt.hash(new_password, 10);
    const authUpdate = await firestore.updateFirebaseAuthUserByEmail(user.email, { password: new_password });
    try {
      const updated = await userAccountStore.updateUser(req.session.userId, {
        password: hashedPassword,
        updated_at: new Date().toISOString()
      });
      if (!updated) throw new Error('Firestore profile disappeared during the update.');
    } catch (error) {
      if (authUpdate.updated) {
        try {
          await firestore.updateFirebaseAuthUserByEmail(user.email, { password: current_password });
        } catch (rollbackError) {
          console.error('[user-profile] Firebase Auth password rollback failed:', rollbackError.message);
        }
      }
      throw error;
    }
    req.session.success = 'Password changed successfully.';
    return res.redirect('/user/settings');
  } catch (error) {
    console.error('[user-profile] Firestore password update failed:', error.message);
    req.session.error = 'Unable to change your password right now.';
    return res.redirect('/user/settings');
  }
});

router.post('/settings/transfer-pin', requireAuth, [
  body('current_password').exists(),
  body('transfer_pin').matches(/^\d{4,6}$/),
  body('confirm_transfer_pin').custom((value, { req }) => value === req.body.transfer_pin)
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Transfer PIN must be 4 to 6 digits and match the confirmation field.';
    return res.redirect('/user/settings');
  }

  const { current_password, transfer_pin } = req.body;
  try {
    const user = await userAccountStore.getUserById(req.session.userId);
    if (!user || !user.password) {
      req.session.error = 'Your profile could not be found.';
      return res.redirect('/user/settings');
    }
    const validPassword = await bcrypt.compare(current_password, user.password);
    if (!validPassword) {
      req.session.error = 'Current password is incorrect.';
      return res.redirect('/user/settings');
    }
    const pinHash = await bcrypt.hash(transfer_pin, 10);
    await userAccountStore.updateUser(req.session.userId, {
      transfer_pin_hash: pinHash,
      transfer_pin_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    req.session.success = hasTransferPin(user)
      ? 'Transfer PIN updated successfully.'
      : 'Transfer PIN created successfully.';
    return res.redirect('/user/settings');
  } catch (error) {
    console.error('[user-profile] Firestore transfer-PIN update failed:', error.message);
    req.session.error = 'Unable to update your transfer PIN right now.';
    return res.redirect('/user/settings');
  }
});

module.exports = router;
