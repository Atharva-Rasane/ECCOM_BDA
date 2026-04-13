import { DataTypes, Model, type ModelStatic } from 'sequelize';
import { type CartItemAttributes } from '../types/models/cartTypes';
import { PRODUCT_SIZES } from '../constants';
import { Product } from '.';

export class CartItem
    extends Model<CartItemAttributes>
    implements CartItemAttributes
{
    id: number;
    size: string;
    quantity: number;
    totalPrice: number;
    productId: number;
    cartId: number;
    Product: Record<string, string | number | null>;
}

export function cartItemFactory(sequelize): ModelStatic<CartItem> {
    CartItem.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            size: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    isIn: {
                        args: [Object.keys(PRODUCT_SIZES)],
                        msg: 'Invalid item size. Select a valid size',
                    },
                },
            },
            quantity: {
                type: DataTypes.INTEGER,
                allowNull: false,
                validate: {
                    min: {
                        args: [1],
                        msg: 'Cart item quantity cannot be less than 1',
                    },
                },
            },
            totalPrice: {
                type: DataTypes.FLOAT(4),
                allowNull: false,
            },
        },
        { sequelize }
    );
    CartItem.beforeSave(async (cartItem) => {
        const product = await Product.findByPk(cartItem.productId);
        if (product === null) {
            return;
        }
        cartItem.totalPrice = cartItem.quantity * product.price;
    });
    return CartItem;
}
