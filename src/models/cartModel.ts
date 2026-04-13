import {
    DataTypes,
    type HasManyCreateAssociationMixin,
    Model,
    type ModelStatic,
    type HasManyGetAssociationsMixin,
    type HasOneSetAssociationMixin,
    type HasOneGetAssociationMixin,
    type HasManyRemoveAssociationsMixin,
} from 'sequelize';
import type {
    CartItemAttributes,
    CartAttributes,
} from '../types/models/cartTypes';
import type { CouponAttributes } from '../types/models/couponTypes';
import { CART_STATES } from '../constants';
import type { Coupon, CartItem } from '.';
import { type UserAttributes } from '../types/models/userTypes';

export class Cart extends Model<CartAttributes> implements CartAttributes {
    id: number;
    couponId!: number;
    cartTotal: number;
    userId: number;
    state: string;
    address: string;
    orderNote: string;
    Coupon?: CouponAttributes;
    User?: UserAttributes;
    // TODO: add date properties to all models
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    CartItems: CartItemAttributes[];
    createCartItem: HasManyCreateAssociationMixin<CartItem>;
    getCartItems: HasManyGetAssociationsMixin<CartItem>;
    removeCartItems: HasManyRemoveAssociationsMixin<CartItem, number>;

    getCoupon: HasOneGetAssociationMixin<Coupon>;
    setCoupon: HasOneSetAssociationMixin<Coupon, number>;
}

export function cartFactory(sequelize): ModelStatic<Cart> {
    return Cart.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            cartTotal: {
                type: DataTypes.FLOAT(4),
                defaultValue: 0,
            },
            state: {
                type: DataTypes.ENUM(...Object.values(CART_STATES)),
                defaultValue: CART_STATES.PENDING,
            },
            address: DataTypes.STRING,
            orderNote: DataTypes.STRING,
        },
        { sequelize }
    );
}
