import 'dotenv/config';
import type { NextFunction, Response } from 'express';
import type { IRequestWithAuthenticatedUser } from '../types/requestTypes';
import db from '../database';
import {
    CART_STATES,
    PRODUCT_SIZES,
    USER_ROLES,
    successfulCheckoutAdminHtmlFilePath,
    successfulCheckoutAdminTextFilePath,
    thankYouCustomerHtmlFilePath,
    thankYouCustomerTextFilePath,
} from '../constants';
import { setFlashMessage } from '../utilities';
import { appConfig } from '../config';
import type { CouponAttributes } from '../types/models/couponTypes';
import { sendEmail } from '../mailer';
import { logTelemetry } from '../telemetry/logger';
import type { RequestWithTelemetry } from '../types/telemetry';

const stripe = require('stripe')(appConfig.STRIPE_API_KEY);

const Cart = db.carts;
const Product = db.products;
const CartItem = db.cartItems;
const Coupon = db.coupons;
const User = db.users;

export async function getCart(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const [userActiveCart] = await Cart.findOrCreate({
            where: {
                state: CART_STATES.PENDING,
                userId: req.user.id,
            },
            include: CartItem,
        });

        const cartItems = await userActiveCart.getCartItems({
            include: Product,
            order: [['createdAt', 'ASC']],
        });

        const cartCoupon = await userActiveCart.getCoupon();

        res.render('cart/cart', {
            cartItems,
            PRODUCT_SIZES,
            cartTotal: userActiveCart.cartTotal,
            cartCoupon,
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'cart.viewed',
            'Cart viewed',
            {
                cart_checkout: {
                    cart_id: userActiveCart.id?.toString(),
                    item_count: cartItems.length,
                    cart_value: Math.round(userActiveCart.cartTotal * 100),
                    currency: 'USD',
                },
            }
        );
    } catch (error) {
        console.log(error.message);
        next(error);
    }
}

export async function addProductToCart(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const productId = parseInt(req.params.productId);
        const { size, quantity } = req.body;

        const [userActiveCart] = await Cart.findOrCreate({
            where: {
                state: CART_STATES.PENDING,
                userId: req.user.id,
            },
            include: CartItem,
        });

        const product = await Product.findByPk(productId);
        if (product === null) {
            setFlashMessage(req, {
                message: 'Product no longer exists!',
                type: 'danger',
            });
            return;
        }

        const productIsInCart = userActiveCart.CartItems?.some(
            (cartItem) => cartItem.productId === product.id
        );
        if (productIsInCart) {
            setFlashMessage(req, {
                message: 'Product is already in cart. Go to Cart to modify it.',
                type: 'info',
            });
            res.redirect('back');
            return;
        }

        const cartItemTotal = quantity * product.price;
        await userActiveCart.createCartItem({
            size,
            quantity,
            productId: product.id,
            totalPrice: cartItemTotal,
        });
        await userActiveCart.update({
            cartTotal: userActiveCart.cartTotal + cartItemTotal,
        });

        setFlashMessage(req, {
            message: `Item has been added to your cart successfully!`,
            type: 'success',
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'cart.item.added',
            'Item added to cart',
            {
                cart_checkout: {
                    cart_id: userActiveCart.id?.toString(),
                    product_id: product.id?.toString(),
                    item_count: userActiveCart.CartItems?.length ?? 1,
                    cart_value: Math.round(
                        (userActiveCart.cartTotal + cartItemTotal) * 100
                    ),
                    currency: 'USD',
                    quantity_delta: quantity,
                },
            }
        );
        res.redirect('back');
    } catch (error) {
        console.log(error.message, error);
        next(error);
    }
}

export async function updateCartState(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { cartId } = req.params;
        const cart = await Cart.findByPk(cartId, { include: [User, Coupon] });

        if (cart === null) {
            setFlashMessage(req, {
                message: 'Cart does not exist again.',
                type: 'warning',
            });
            res.redirect('back');
            return;
        }

        await cart.update(
            { state: CART_STATES.DELIVERED },
            {
                where: {
                    id: cartId,
                },
            }
        );

        const cartItems = await cart?.getCartItems({
            include: Product,
        });

        const adminEmails = (
            await User.findAll({
                where: {
                    role: USER_ROLES.admin,
                },
                attributes: ['email'],
            })
        ).map((user) => user.email);

        if (cart.state === 'DELIVERED' && cart.User !== undefined) {
            void sendEmail({
                receivers: [cart.User.email],
                subject: 'Invoice: Thanks for shopping with us!',
                textFilePath: thankYouCustomerTextFilePath,
                htmlFilePath: thankYouCustomerHtmlFilePath,
                htmlData: { APP_DOMAIN: appConfig.APP_DOMAIN, cart, cartItems },
                cc: adminEmails,
            });
        }
        setFlashMessage(req, {
            message: 'Order completed succesfully!',
            type: 'success',
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'checkout.step.reached',
            'Cart marked delivered',
            {
                cart_checkout: {
                    cart_id: cartId,
                    checkout_step: 'complete',
                },
            }
        );
        res.redirect('back');
    } catch (err) {
        console.log(err);
        next(err);
    }
}

export async function removeProductFromCart(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const cartItemId: string = req.params.cartItemId;
        const userActiveCart = await Cart.findOne({
            where: {
                userId: req.user.id,
                state: CART_STATES.PENDING,
            },
        });
        if (userActiveCart === null) {
            setFlashMessage(req, {
                message: 'Your cart does not exist again. Add a new product',
                type: 'warning',
            });
            res.redirect('back');
            return;
        }

        const cartItem = await CartItem.findOne({
            where: {
                id: cartItemId,
                cartId: userActiveCart.id,
            },
        });

        if (cartItem === null) {
            res.redirect('back');
            return;
        }

        await CartItem.destroy({
            where: {
                id: cartItemId,
                cartId: userActiveCart.id,
            },
        });
        await userActiveCart.update({
            cartTotal: userActiveCart.cartTotal - cartItem?.totalPrice,
        });

        setFlashMessage(req, {
            message: 'Item removed from your cart successfully!',
            type: 'success',
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'cart.item.removed',
            'Item removed from cart',
            {
                cart_checkout: {
                    cart_id: userActiveCart.id?.toString(),
                    product_id: cartItem?.productId?.toString(),
                    item_count: userActiveCart.CartItems?.length ?? 0,
                    cart_value: Math.round(
                        (userActiveCart.cartTotal - cartItem.totalPrice) * 100
                    ),
                    currency: 'USD',
                    quantity_delta: -1,
                },
            }
        );
        res.redirect('back');
    } catch (error) {
        console.log(error.message, error);
        next(error);
    }
}

export async function updateCart(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { body: cartItemsUpdate } = req;
        const userActiveCart = await Cart.findOne({
            where: {
                userId: req.user.id,
                state: CART_STATES.PENDING,
            },
        });
        if (userActiveCart === null) {
            res.redirect('back');
            return;
        }

        for (const cartItemId of Object.keys(cartItemsUpdate)) {
            await CartItem.update(
                { ...cartItemsUpdate[cartItemId] },
                {
                    where: { cartId: userActiveCart.id, id: cartItemId },
                    individualHooks: true,
                }
            );
        }

        const cartTotal = (await userActiveCart.getCartItems()).reduce(
            (acc, cartItem) => acc + cartItem.totalPrice,
            0
        );
        await userActiveCart.update({ cartTotal });
        setFlashMessage(req, {
            message: 'Cart updated successfully!',
            type: 'success',
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'cart.item.updated',
            'Cart items updated',
            {
                cart_checkout: {
                    cart_id: userActiveCart.id?.toString(),
                    item_count: Object.keys(cartItemsUpdate).length,
                    cart_value: Math.round(cartTotal * 100),
                    currency: 'USD',
                },
            }
        );
        res.redirect('back');
    } catch (error) {
        console.log(error.message);
        next(error);
    }
}

export async function getClearCart(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { cartId } = req.params;
        const userActiveCart = await Cart.findOne({
            where: {
                id: cartId,
                userId: req.user.id,
            },
            include: CartItem,
        });

        if (
            userActiveCart === null ||
            userActiveCart.state !== CART_STATES.PENDING
        ) {
            setFlashMessage(req, {
                message: 'You can only clear your current/pending carts',
                type: 'info',
            });
            res.redirect('back');
            return;
        }

        const cartItemsIds = userActiveCart.CartItems.map(
            (cartItem) => cartItem.id
        ) as number[];
        await userActiveCart.removeCartItems(cartItemsIds);
        await userActiveCart.update({ cartTotal: 0 });

        setFlashMessage(req, {
            message: 'Cart cleared successfully!',
            type: 'success',
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'cart.cleared',
            'Cart cleared',
            {
                cart_checkout: {
                    cart_id: userActiveCart.id?.toString(),
                    item_count: 0,
                    cart_value: 0,
                    currency: 'USD',
                },
            }
        );
        res.redirect('back');
    } catch (err) {
        console.log(err);
        next(err);
    }
}

export async function addCouponToCart(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { couponCode } = req.body;

        const coupon = await Coupon.findOne({ where: { code: couponCode } });
        if (coupon === null) {
            setFlashMessage(req, {
                message: 'Coupon code is invalid',
                type: 'warning',
            });
            res.redirect('back');
            return;
        }

        const userActiveCart = await Cart.findOne({
            where: {
                userId: req.user.id,
                state: CART_STATES.PENDING,
            },
        });

        if (userActiveCart === null) {
            setFlashMessage(req, {
                message: 'Something strange happended. Try again!',
                type: 'warning',
            });
            res.redirect('back');
            return;
        }

        if (userActiveCart.couponId === coupon.id) {
            setFlashMessage(req, {
                message: 'Coupon has been added for this cart already!',
                type: 'info',
            });
            res.redirect('back');
            return;
        }

        if (coupon.usage >= coupon.maxUsage) {
            setFlashMessage(req, {
                message: 'Coupon has reached its max limit',
                type: 'info',
            });
            res.redirect('back');
            return;
        }

        await userActiveCart.setCoupon(coupon.id);
        await coupon.update({ usage: coupon.usage + 1 });

        setFlashMessage(req, {
            message: 'Coupon added succesfully!',
            type: 'success',
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'cart.coupon.applied',
            'Coupon applied',
            {
                cart_checkout: {
                    cart_id: userActiveCart.id?.toString(),
                    coupon_code: coupon.code.slice(0, 3) + '***',
                    cart_value: Math.round(userActiveCart.cartTotal * 100),
                },
            }
        );
        res.redirect('back');
    } catch (error) {
        console.log(error);
        console.log(error.message);
        next(error);
    }
}

export async function getCheckout(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userActiveCart = await Cart.findOne({
            where: {
                state: CART_STATES.PENDING,
                userId: req.user.id,
            },
            include: [Coupon],
        });

        if (userActiveCart === null) {
            setFlashMessage(req, {
                message:
                    'You do not have an active cart. Go and add some items to cart.',
                type: 'info',
            });
            res.redirect('back');
            return;
        }

        const cartItems = await userActiveCart.getCartItems({
            include: Product,
            order: [['createdAt', 'ASC']],
        });

        res.render('cart/checkout', {
            cartItems,
            orderNote: userActiveCart.orderNote,
            coupon: userActiveCart.Coupon,
            cartTotal: userActiveCart.cartTotal,
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'cart_checkout',
            'checkout.initiated',
            'Checkout initiated',
            {
                cart_checkout: {
                    cart_id: userActiveCart.id?.toString(),
                    item_count: cartItems.length,
                    cart_value: Math.round(userActiveCart.cartTotal * 100),
                    currency: 'USD',
                },
            }
        );
    } catch (err) {
        console.log(err);
        next(err);
    }
}

export async function postCheckout(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userActiveCart = await Cart.findOne({
            where: {
                state: CART_STATES.PENDING,
                userId: req.user.id,
            },
            include: Coupon,
        });

        if (userActiveCart === null) {
            setFlashMessage(req, {
                message:
                    'You do not have an active cart. Go and add some items to cart.',
                type: 'info',
            });
            res.redirect('back');
            return;
        }

        const cartItems = await userActiveCart.getCartItems({
            include: Product,
            order: [['createdAt', 'ASC']],
        });

        if (cartItems.length <= 0) {
            setFlashMessage(req, {
                message: 'Your cart is empty. Go shopping :)',
                type: 'warning',
            });
            res.redirect('back');
            return;
        }

        const checkoutItems = cartItems.map((cartItem) => {
            const amount = cartItem.Product.price as number;
            return {
                price_data: {
                    unit_amount: parseFloat((amount * 100).toFixed(2)), // unit amount takes in amount in cent by default, hence, multiplying by 100
                    product_data: {
                        name: cartItem.Product.name,
                        description: cartItem.Product.shortDescription,
                        images: [cartItem.Product.imageURL],
                    },
                    currency: 'usd',
                },
                quantity: cartItem.quantity,
            };
        });

        const userCoupon = userActiveCart.Coupon as CouponAttributes | null;
        let coupon;

        if (userCoupon !== null) {
            coupon = await stripe.coupons.create({
                amount_off: userCoupon.amount * 100,
                currency: 'usd',
                duration: 'once',
            });
        }

        const checkoutSession = await stripe.checkout.sessions.create({
            line_items: checkoutItems,
            discounts: [{ coupon: coupon?.id }],
            mode: 'payment',
            success_url: `${appConfig.APP_DOMAIN}/cart/checkout/success`,
            cancel_url: `${appConfig.APP_DOMAIN}/cart/checkout/cancel`,
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'payment_fraud',
            'payment.initiated',
            'Stripe checkout session created',
            {
                payment_fraud: {
                    payment_id: checkoutSession.id,
                    gateway: 'stripe',
                    payment_method: 'card',
                    amount: Math.round(userActiveCart.cartTotal * 100),
                    currency: 'usd',
                    order_id: userActiveCart.id?.toString(),
                },
            }
        );
        res.redirect(303, checkoutSession.url);
    } catch (err) {
        console.log(err);
        next(err);
    }
}

export async function getCheckoutSuccess(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userActiveCart = await Cart.findOne({
            where: {
                state: CART_STATES.PENDING,
                userId: req.user.id,
            },
        });

        if (userActiveCart === null) {
            setFlashMessage(req, {
                message:
                    'You do not have an active cart. Go and add some items to cart.',
                type: 'info',
            });
            res.redirect('back');
            return;
        }

        await userActiveCart.update({
            state: CART_STATES.PROCESSING,
            address: `${req.user.Address?.street ?? ''} - ${
                req.user.Address?.state ?? ''
            } - ${req.user.Address?.country ?? ''}`,
        });

        const adminEmails = (
            await User.findAll({
                where: {
                    role: USER_ROLES.admin,
                },
                attributes: ['email'],
            })
        ).map((user) => user.email);

        void sendEmail({
            receivers: adminEmails,
            subject: 'New Trendtrove Order Payed for!',
            textFilePath: successfulCheckoutAdminTextFilePath,
            htmlFilePath: successfulCheckoutAdminHtmlFilePath,
            htmlData: { APP_DOMAIN: appConfig.APP_DOMAIN },
            req,
        });
        logTelemetry(
            req,
            res,
            'INFO',
            'payment_fraud',
            'payment.succeeded',
            'Checkout succeeded',
            {
                payment_fraud: {
                    payment_id: userActiveCart.id?.toString(),
                    gateway: 'stripe',
                    amount: Math.round(userActiveCart.cartTotal * 100),
                    currency: 'usd',
                    gateway_status: 'succeeded',
                    order_id: userActiveCart.id?.toString(),
                },
            }
        );
        res.render('cart/success');
    } catch (err) {
        console.log(err);
        next(err);
    }
}

export async function getCheckoutCancel(
    req: IRequestWithAuthenticatedUser & RequestWithTelemetry,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userActiveCart = await Cart.findOne({
            where: {
                state: CART_STATES.PENDING,
                userId: req.user.id,
            },
        });
        logTelemetry(
            req,
            res,
            'WARN',
            'cart_checkout',
            'cart.abandoned',
            'User returned from Stripe checkout without completing payment',
            userActiveCart
                ? {
                      cart_checkout: {
                          cart_id: userActiveCart.id?.toString(),
                          cart_value: Math.round(userActiveCart.cartTotal * 100),
                          currency: 'USD',
                          stage: 'stripe_cancel_return',
                      },
                  }
                : {}
        );
        res.render('cart/cancel');
    } catch (err) {
        console.log(err);
        next(err);
    }
}
